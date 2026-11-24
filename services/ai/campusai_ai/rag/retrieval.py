"""Hybrid retrieval (dense pgvector + Postgres full-text) fused with Reciprocal Rank Fusion (blueprint 9.1.6, 9.3.4)."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

from .. import db
from ..embeddings import get_embedder

RRF_K = 60
STOP = {"the", "and", "for", "what", "how", "why", "does", "this", "that", "with", "from", "are", "was", "were", "can", "you", "explain", "about",
        "between", "difference", "tell", "give", "show", "please", "which", "when", "where", "who", "its", "his", "her", "their", "into", "than", "then",
        "have", "has", "had", "not", "but", "any", "all", "use", "used", "using", "define", "describe", "mean", "meaning", "example", "examples"}


def keywords(text: str, limit: int = 12) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", text)
    out, seen = [], set()
    for w in words:
        lw = w.lower()
        if lw in STOP or lw in seen:
            continue
        seen.add(lw)
        out.append(lw)
    return out[:limit]


def or_tsquery(words: list[str]) -> str:
    return " | ".join(f"{w}" for w in words if re.fullmatch(r"[a-z0-9_]+", w))


@dataclass
class Hit:
    id: str
    document_id: str
    title: str
    page_start: int
    page_end: int
    section_path: str
    content: str
    topic_id: str | None
    chunk_index: int
    dense: float = 0.0
    lex: float = 0.0
    fused: float = 0.0
    parts: list[str] = field(default_factory=list)


def rrf(ranked_lists: list[list[str]], k: int = RRF_K) -> dict[str, float]:
    scores: dict[str, float] = {}
    for lst in ranked_lists:
        for rank, key in enumerate(lst, 1):
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank)
    return scores


def stitch(hits: list[Hit]) -> list[Hit]:
    """Merge selected chunks that are neighbours (i, i+1) in the same document."""
    by_doc: dict[str, list[Hit]] = {}
    for h in hits:
        by_doc.setdefault(h.document_id, []).append(h)
    merged: list[Hit] = []
    for doc, hs in by_doc.items():
        hs.sort(key=lambda x: x.chunk_index)
        cur = None
        for h in hs:
            if cur and h.chunk_index == cur.chunk_index + 1 and len(cur.content) + len(h.content) < 3600:
                cur.content += "\n\n" + h.content
                cur.page_end = max(cur.page_end, h.page_end)
                cur.chunk_index = h.chunk_index
                cur.dense = max(cur.dense, h.dense)
                cur.fused = max(cur.fused, h.fused)
                cur.parts.append(h.id)
            else:
                if cur:
                    merged.append(cur)
                cur = Hit(**{**h.__dict__, "parts": [h.id]})
        if cur:
            merged.append(cur)
    merged.sort(key=lambda x: -x.fused)
    return merged


async def search_documents(user_id: str, query: str, *, document_ids: list[str] | None = None, subject_id: str | None = None,
                           top_k: int = 8, per_list: int = 30, qvec=None, mode: str = "hybrid") -> list[Hit]:
    """mode: hybrid | dense | lexical (used by the evaluation harness for ablations)."""
    uid = uuid.UUID(user_id)
    if qvec is None and mode != "lexical":
        qvec = await get_embedder().embed_query(query)
    scope = ""
    args: list = [uid]
    if document_ids:
        args.append([uuid.UUID(d) for d in document_ids])
        scope += f" and c.document_id = any(${len(args)})"
    elif subject_id:
        args.append(uuid.UUID(subject_id))
        scope += f" and c.subject_id = ${len(args)}"
    base_cols = "c.id, c.document_id, d.title, c.page_start, c.page_end, c.section_path, c.content, c.topic_id, c.chunk_index"
    rows: dict[str, Hit] = {}
    dense_rank: list[str] = []
    lex_rank: list[str] = []

    def mk(r) -> Hit:
        return Hit(str(r["id"]), str(r["document_id"]), r["title"], r["page_start"], r["page_end"], r["section_path"] or "", r["content"],
                   str(r["topic_id"]) if r["topic_id"] else None, r["chunk_index"])

    if mode in ("hybrid", "dense"):
        a = args + [qvec]
        async with db.tx(user_id) as c:
            await c.execute("select set_config('hnsw.ef_search','200', true)")
            drows = await c.fetch(
                f"select {base_cols}, 1 - (c.embedding <=> ${len(a)}) as dense from ai.doc_chunks c join app.documents d on d.id=c.document_id "
                f"where c.user_id=$1 {scope} order by c.embedding <=> ${len(a)} limit {per_list}", *a)
        for r in drows:
            h = rows.setdefault(str(r["id"]), mk(r))
            h.dense = float(r["dense"])
            dense_rank.append(h.id)
    if mode in ("hybrid", "lexical"):
        q = or_tsquery(keywords(query))
        if q:
            a = args + [q]
            lrows = await db.fetch(
                f"select {base_cols}, ts_rank_cd(c.content_tsv, to_tsquery('english', ${len(a)})) as lex from ai.doc_chunks c join app.documents d on d.id=c.document_id "
                f"where c.user_id=$1 {scope} and c.content_tsv @@ to_tsquery('english', ${len(a)}) order by lex desc limit {per_list}", *a)
            for r in lrows:
                h = rows.setdefault(str(r["id"]), mk(r))
                h.lex = float(r["lex"])
                lex_rank.append(h.id)
    fused = rrf([l for l in (dense_rank, lex_rank) if l])
    for k, v in fused.items():
        rows[k].fused = v
    if qvec is not None:
        # lexical-only candidates have no dense score yet: compute it so downstream grading is consistent
        missing = [k for k, h in rows.items() if h.dense == 0.0]
        if missing:
            drows = await db.fetch("select id, 1 - (embedding <=> $2) as dense from ai.doc_chunks where user_id=$1 and id = any($3)", uid, qvec,
                                   [uuid.UUID(m) for m in missing])
            for r in drows:
                rows[str(r["id"])].dense = float(r["dense"])
    ordered = sorted(rows.values(), key=lambda h: -h.fused)[:top_k]
    return ordered


def build_context(hits: list[Hit], max_chars: int = 18000) -> tuple[str, list[Hit]]:
    """Numbered <source> blocks within a character budget (~4.5k tokens)."""
    parts, used, total = [], [], 0
    for i, h in enumerate(hits, 1):
        pages = f"{h.page_start}-{h.page_end}" if h.page_end != h.page_start else str(h.page_start)
        body = h.content if len(h.content) < 3600 else h.content[:3600] + " …"
        block = f'<source id="S{i}" doc="{h.title}" pages="{pages}" section="{h.section_path}">\n{body}\n</source>'
        if total + len(block) > max_chars and used:
            break
        parts.append(block)
        used.append(h)
        total += len(block)
    return "\n\n".join(parts), used


# ---------------- code ----------------
@dataclass
class CodeHit:
    id: str
    path: str
    start_line: int
    end_line: int
    symbol: str | None
    kind: str | None
    language: str | None
    content: str
    score: float = 0.0
    dense: float = 0.0


IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*")


def code_identifiers(query: str) -> list[str]:
    out = []
    for m in IDENT.findall(query):
        if len(m) < 3:
            continue
        is_code_like = ("_" in m) or ("." in m) or re.search(r"[a-z][A-Z]", m) or re.fullmatch(r"[A-Z][a-z]+[A-Z][A-Za-z]*", m)
        if is_code_like:
            out.append(m)
    return list(dict.fromkeys(out))[:6]


async def find_symbols(user_id: str, repo_id: str, name: str, limit: int = 10):
    n = name.strip().lower()
    short = n.rsplit(".", 1)[-1]
    return await db.fetch(
        """select s.name, s.qualified_name, s.kind, s.signature, s.start_line, s.end_line, f.path
           from ai.code_symbols s join ai.code_files f on f.id=s.file_id
           where s.user_id=$1 and s.repository_id=$2 and (lower(s.name)=$3 or lower(s.qualified_name)=$4 or lower(s.qualified_name) like $5)
           order by (lower(s.qualified_name)=$4) desc, (lower(s.name)=$3) desc limit $6""",
        uuid.UUID(user_id), uuid.UUID(repo_id), short, n, "%" + n, limit)


async def search_code(user_id: str, repo_id: str, query: str, *, path_prefix: str | None = None, language: str | None = None, top_k: int = 8,
                      mode: str = "hybrid", identifier_boost: bool = True) -> list[CodeHit]:
    uid, rid = uuid.UUID(user_id), uuid.UUID(repo_id)
    scope = ""
    args: list = [uid, rid]
    if path_prefix:
        args.append(path_prefix + "%")
        scope += f" and c.path like ${len(args)}"
    if language:
        args.append(language.lower())
        scope += f" and c.language = ${len(args)}"
    cols = "c.id, c.path, c.start_line, c.end_line, c.symbol_name, c.symbol_kind, c.language, c.content"
    rows: dict[str, CodeHit] = {}
    dense_rank, lex_rank, sym_rank = [], [], []

    def mk(r) -> CodeHit:
        return CodeHit(str(r["id"]), r["path"], r["start_line"], r["end_line"], r["symbol_name"], r["symbol_kind"], r["language"], r["content"])

    qvec = None
    if mode in ("hybrid", "dense"):
        qvec = await get_embedder().embed_query(query)
        a = args + [qvec]
        async with db.tx(user_id) as c:
            await c.execute("select set_config('hnsw.ef_search','200', true)")
            drows = await c.fetch(
                f"select {cols}, 1 - (c.embedding <=> ${len(a)}) as dense from ai.code_chunks c where c.user_id=$1 and c.repository_id=$2 {scope} "
                f"order by c.embedding <=> ${len(a)} limit 30", *a)
        for r in drows:
            h = rows.setdefault(str(r["id"]), mk(r))
            h.dense = float(r["dense"])
            dense_rank.append(h.id)
    if mode in ("hybrid", "lexical"):
        words = keywords(" ".join(re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", w).replace("_", " ") for w in re.findall(r"[A-Za-z_][A-Za-z0-9_.]*", query)), 14)
        q = or_tsquery(words)
        if q:
            a = args + [q]
            lrows = await db.fetch(
                f"select {cols}, ts_rank_cd(c.content_tsv, to_tsquery('simple', ${len(a)})) as lex from ai.code_chunks c where c.user_id=$1 and c.repository_id=$2 {scope} "
                f"and c.content_tsv @@ to_tsquery('simple', ${len(a)}) order by lex desc limit 30", *a)
            for r in lrows:
                h = rows.setdefault(str(r["id"]), mk(r))
                lex_rank.append(h.id)
    if identifier_boost and mode == "hybrid":
        for ident in code_identifiers(query):
            syms = await find_symbols(user_id, repo_id, ident, 5)
            for s in syms:
                crow = await db.fetch(
                    f"select {cols} from ai.code_chunks c where c.user_id=$1 and c.repository_id=$2 and c.path=$3 and c.start_line <= $4 and c.end_line >= $5 order by (c.end_line - c.start_line) limit 1",
                    uid, rid, s["path"], s["end_line"] or s["start_line"], s["start_line"])
                for r in crow:
                    h = rows.setdefault(str(r["id"]), mk(r))
                    if h.id not in sym_rank:
                        sym_rank.append(h.id)
    scores = rrf([l for l in (sym_rank, dense_rank, lex_rank) if l])
    for k, v in scores.items():
        rows[k].score = v
    return sorted(rows.values(), key=lambda h: -h.score)[:top_k]
