"""PDF/DOCX ingestion workflow: extract -> clean -> outline -> chunk -> embed -> transactional write."""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from .. import db
from ..config import get_settings
from ..embeddings import get_embedder
from ..errors import BadInput, NotFound
from . import chunking as ck
from .jobs import progress

log = logging.getLogger("campusai.ingest")
MAX_PAGES = 400


@dataclass
class Extracted:
    pages: list[tuple[int, str]]
    toc: list[tuple[int, str, int]] = field(default_factory=list)
    page_count: int = 0
    ocr_pages: int = 0


def storage_path(key: str) -> Path:
    root = Path(get_settings().file_storage_dir).resolve()
    p = (root / key).resolve()
    if root not in p.parents and p != root:
        raise BadInput("Invalid storage key")
    return p


def extract_pdf(path: Path) -> Extracted:
    import pymupdf

    doc = pymupdf.open(str(path))
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise BadInput("This PDF is password-protected. Remove the password and upload it again.", "ENCRYPTED_PDF")
        n = doc.page_count
        if n == 0:
            raise BadInput("The PDF has no pages.")
        if n > MAX_PAGES:
            raise BadInput(f"The PDF has {n} pages; the limit is {MAX_PAGES}.", "TOO_MANY_PAGES")
        pages: list[tuple[int, str]] = []
        try:
            import pymupdf4llm

            chunks = pymupdf4llm.to_markdown(doc, page_chunks=True, show_progress=False)
            for i, c in enumerate(chunks):
                meta = c.get("metadata", {}) or {}
                num = int(meta.get("page") or meta.get("page_number") or (i + 1))
                pages.append((num, c.get("text", "")))
        except Exception as e:  # fall back to plain text extraction
            log.warning("pymupdf4llm failed (%s); using plain text", e)
            pages = [(i + 1, doc[i].get_text("text")) for i in range(n)]
        ocr_pages = 0
        fixed: list[tuple[int, str]] = []
        for num, text in pages:
            if len(text.strip()) < 50:
                page = doc[num - 1]
                if page.get_images():
                    try:
                        tp = page.get_textpage_ocr(language="eng", dpi=300, full=True)
                        o = page.get_text("text", textpage=tp)
                        if len(o.strip()) >= 50:
                            text = o
                            ocr_pages += 1
                    except Exception:
                        pass  # Tesseract not installed: page stays empty
            fixed.append((num, text))
        toc = [(int(l), str(t).strip(), int(p)) for l, t, p in doc.get_toc(simple=True) if p and p > 0 and str(t).strip()]
        return Extracted(fixed, toc, n, ocr_pages)
    finally:
        doc.close()


def extract_docx(path: Path) -> Extracted:
    import docx

    d = docx.Document(str(path))
    sections: list[list[str]] = [[]]
    for block in d.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = docx.text.paragraph.Paragraph(block, d)
            text = para.text.strip()
            if not text:
                continue
            style = (para.style.name or "") if para.style is not None else ""
            m = re.match(r"Heading (\d)", style)
            if m:
                lvl = int(m.group(1))
                if lvl == 1 and sections[-1]:
                    sections.append([])
                sections[-1].append("#" * lvl + " " + text)
            elif style == "Title":
                sections[-1].append("# " + text)
            else:
                sections[-1].append(text)
        elif tag == "tbl":
            tbl = docx.table.Table(block, d)
            rows = [[c.text.strip().replace("\n", " ") for c in r.cells] for r in tbl.rows]
            if rows:
                lines = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * len(rows[0])]
                lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
                sections[-1].append("\n".join(lines))
    sections = [s for s in sections if s]
    pages = [(i + 1, "\n\n".join(s)) for i, s in enumerate(sections)]
    return Extracted(pages, [], len(pages), 0)


def build_topics(ex: Extracted, blocks: list[ck.Block]) -> list[dict]:
    """Outline: PDF TOC -> markdown headings -> fixed page windows. Returns topic dicts with parent index."""
    n = ex.page_count or (ex.pages[-1][0] if ex.pages else 1)
    entries: list[tuple[int, str, int]] = []
    if ex.toc:
        entries = [(min(l, 2), t, min(p, n)) for l, t, p in ex.toc if l <= 2]
    if len(entries) < 2:
        seen = set()
        entries = []
        for b in blocks:
            parts = b.section.split(" › ") if b.section else []
            if len(parts) in (1, 2) and b.text == parts[-1] and (len(parts), b.section) not in seen:
                seen.add((len(parts), b.section))
                entries.append((len(parts), parts[-1], b.page))
    if len(entries) < 2:  # flat notes: fixed windows
        entries = []
        step = 10
        for start in range(1, n + 1, step):
            end = min(n, start + step - 1)
            first = next((t.strip().split("\n")[0] for pn, t in ex.pages if start <= pn <= end and t.strip()), "")
            first = re.sub(r"^#+\s*", "", first)[:60]
            title = f"Pages {start}–{end}" + (f": {first}" if first else "") if n > 1 else (first or "Document")
            entries.append((1, title, start))
    entries = entries[:80]
    topics: list[dict] = []
    last_l1 = None
    for i, (lvl, title, page) in enumerate(entries):
        end = n
        for lvl2, _t, p2 in entries[i + 1:]:
            if lvl2 <= lvl:
                end = max(page, p2 - 1 if p2 > page else p2)
                break
        if lvl == 1:
            last_l1 = len(topics)
        topics.append({"title": title[:250], "level": lvl, "page_start": page, "page_end": max(page, end),
                       "parent": last_l1 if lvl == 2 else None})
    return topics


def topic_for_page(topics: list[dict], page: int) -> int | None:
    best = None
    for i, t in enumerate(topics):
        if t["page_start"] <= page <= t["page_end"]:
            if best is None or t["level"] >= topics[best]["level"]:
                best = i
    return best


async def ingest_document(job: dict) -> dict:
    user_id = str(job["user_id"])
    doc_id = uuid.UUID(job["payload"]["documentId"])
    doc = await db.fetchrow("select * from app.documents where id=$1 and user_id=$2", doc_id, uuid.UUID(user_id))
    if not doc:
        raise NotFound("Document")
    await db.execute("update app.documents set status='PROCESSING', error_message=null, updated_at=now() where id=$1", doc_id)
    jid = job["id"]
    try:
        await progress(jid, "EXTRACTING", 5)
        path = storage_path(doc["storage_key"])
        if not path.exists():
            raise BadInput("Stored file is missing.")
        ext = path.suffix.lower()
        ex = await asyncio.to_thread(extract_pdf if ext == ".pdf" else extract_docx, path)
        total_chars = sum(len(t.strip()) for _, t in ex.pages)
        if total_chars < 100:
            raise BadInput("No extractable text found. This looks like a scanned document and OCR (Tesseract) is not available.", "NO_TEXT")
        await progress(jid, "CHUNKING", 30)
        pages = [(n, ck.clean_page_text(t)) for n, t in ex.pages]
        pages = ck.strip_repeated_lines(pages)
        blocks = ck.to_blocks(pages)
        chunks = ck.chunk_blocks(blocks)
        if not chunks:
            raise BadInput("No text chunks could be produced from this document.")
        topics = build_topics(ex, blocks)
        await progress(jid, "EMBEDDING", 40)
        emb = get_embedder()
        texts = [ck.embedding_text(doc["title"], c) for c in chunks]
        vectors = []
        B = 48
        for i in range(0, len(texts), B):
            vectors.extend(await emb.embed_passages(texts[i:i + B]))
            await progress(jid, "EMBEDDING", 40 + int(50 * min(1.0, (i + B) / len(texts))))
        await progress(jid, "WRITING", 93)
        topic_ids = [uuid.uuid4() for _ in topics]
        async with db.tx(user_id) as c:
            await c.execute("delete from ai.doc_chunks where document_id=$1", doc_id)
            await c.execute("delete from app.topics where document_id=$1", doc_id)
            for i, t in enumerate(topics):
                parent = topic_ids[t["parent"]] if t["parent"] is not None else None
                await c.execute(
                    "insert into app.topics(id, user_id, document_id, parent_id, title, level, order_index, page_start, page_end) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    topic_ids[i], uuid.UUID(user_id), doc_id, parent, t["title"], t["level"], i, t["page_start"], t["page_end"])
            rows = []
            for ch, vec in zip(chunks, vectors):
                ti = topic_for_page(topics, ch.page_start)
                rows.append((uuid.uuid4(), uuid.UUID(user_id), doc_id, doc["subject_id"], topic_ids[ti] if ti is not None else None, ch.index,
                             ch.text, ch.section_path[:500], ch.page_start, ch.page_end, min(ch.tokens, 32000), vec))
            await c.executemany(
                """insert into ai.doc_chunks(id, user_id, document_id, subject_id, topic_id, chunk_index, content, section_path, page_start, page_end, token_count, embedding)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)""", rows)
            await c.execute(
                "update app.documents set status='READY', page_count=$2, chunk_count=$3, ocr_pages=$4, embedding_model=$5, error_message=null, updated_at=now() where id=$1",
                doc_id, ex.page_count, len(chunks), ex.ocr_pages, get_settings().embedding_model)
        return {"documentId": str(doc_id), "chunks": len(chunks), "topics": len(topics), "pages": ex.page_count}
    except Exception as e:
        msg = getattr(e, "message", None) or str(e)
        await db.execute("update app.documents set status='FAILED', error_message=$2, updated_at=now() where id=$1", doc_id, msg[:480])
        raise
