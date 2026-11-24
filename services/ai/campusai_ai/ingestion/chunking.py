"""Structure-aware chunking with page mapping (blueprint 9.1.5). Pure functions, unit tested."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

TARGET_TOKENS = 420
MAX_TOKENS = 520
MIN_TOKENS = 120
OVERLAP_TOKENS = 60


def tok(text: str) -> int:
    """Cheap token estimate (words * 1.3)."""
    return int(len(text.split()) * 1.3) + 1


@dataclass
class Block:
    text: str
    page: int
    section: str  # section path
    is_table: bool = False
    is_code: bool = False


@dataclass
class Chunk:
    index: int
    text: str
    section_path: str
    page_start: int
    page_end: int
    tokens: int


_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def clean_page_text(text: str) -> str:
    text = text.replace("\r", "")
    text = re.sub(r"-\n(?=[a-z])", "", text)  # de-hyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_repeated_lines(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Removes header/footer lines that repeat on >50% of pages, and bare page-number lines."""
    if len(pages) < 4:
        return [(n, re.sub(r"(?m)^\s*(?:page\s*)?\d{1,4}\s*$", "", t)) for n, t in pages]
    counts: dict[str, int] = {}
    for _, t in pages:
        seen = set()
        for ln in t.split("\n"):
            s = ln.strip()
            if 2 < len(s) < 90 and s not in seen:
                seen.add(s)
                counts[s] = counts.get(s, 0) + 1
    repeated = {s for s, c in counts.items() if c > len(pages) * 0.5}
    out = []
    for n, t in pages:
        lines = [ln for ln in t.split("\n") if ln.strip() not in repeated and not re.fullmatch(r"\s*(?:page\s*)?\d{1,4}\s*", ln, flags=re.I)]
        out.append((n, "\n".join(lines)))
    return out


def to_blocks(pages: list[tuple[int, str]]) -> list[Block]:
    """Splits page markdown into paragraph/table/code blocks, tracking the heading path."""
    blocks: list[Block] = []
    stack: list[tuple[int, str]] = []
    for page_no, text in pages:
        in_code = False
        buf: list[str] = []

        def flush(kind_table=False, kind_code=False):
            nonlocal buf
            if buf:
                t = "\n".join(buf).strip()
                if t:
                    blocks.append(Block(t, page_no, " › ".join(h for _, h in stack), kind_table, kind_code))
            buf = []

        for line in text.split("\n"):
            if line.strip().startswith("```"):
                if in_code:
                    buf.append(line)
                    flush(kind_code=True)
                    in_code = False
                else:
                    flush()
                    buf.append(line)
                    in_code = True
                continue
            if in_code:
                buf.append(line)
                continue
            m = _HEADING.match(line)
            if m:
                flush()
                level = len(m.group(1))
                title = re.sub(r"[*_`]", "", m.group(2)).strip()
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, title))
                blocks.append(Block(title, page_no, " › ".join(h for _, h in stack)))  # heading text is searchable content
                continue
            if not line.strip():
                is_table = bool(buf) and all(b.strip().startswith("|") for b in buf)
                flush(kind_table=is_table)
                continue
            buf.append(line)
        if in_code:
            flush(kind_code=True)
        else:
            is_table = bool(buf) and all(b.strip().startswith("|") for b in buf)
            flush(kind_table=is_table)
    return blocks


def _split_oversized(b: Block, max_tokens: int) -> list[Block]:
    if tok(b.text) <= max_tokens:
        return [b]
    if b.is_table:
        lines = b.text.split("\n")
        header = lines[:2]
        out, cur = [], list(header)
        for ln in lines[2:]:
            cur.append(ln)
            if tok("\n".join(cur)) >= max_tokens:
                out.append(Block("\n".join(cur), b.page, b.section, True))
                cur = list(header)
        if len(cur) > len(header):
            out.append(Block("\n".join(cur), b.page, b.section, True))
        return out
    if b.is_code:
        lines = b.text.split("\n")
        out, cur = [], []
        for ln in lines:
            cur.append(ln)
            if tok("\n".join(cur)) >= max_tokens:
                out.append(Block("\n".join(cur), b.page, b.section, False, True))
                cur = []
        if cur:
            out.append(Block("\n".join(cur), b.page, b.section, False, True))
        return out
    sents = _SENT.split(b.text)
    out, cur = [], []
    for s in sents:
        if tok(s) > max_tokens:  # a single huge "sentence": hard split by words
            words = s.split()
            step = int(max_tokens / 1.3)
            for i in range(0, len(words), step):
                out.append(Block(" ".join(words[i:i + step]), b.page, b.section))
            continue
        cur.append(s)
        if tok(" ".join(cur)) >= max_tokens:
            out.append(Block(" ".join(cur), b.page, b.section))
            cur = []
    if cur:
        out.append(Block(" ".join(cur), b.page, b.section))
    return out


def _overlap_tail(text: str, tokens: int) -> str:
    sents = _SENT.split(text)
    tail: list[str] = []
    for s in reversed(sents):
        if tok(" ".join(tail + [s])) > tokens and tail:
            break
        tail.insert(0, s)
        if tok(" ".join(tail)) >= tokens:
            break
    t = " ".join(tail)
    return t if tok(t) <= tokens * 2 else ""


def chunk_blocks(blocks: list[Block], target: int = TARGET_TOKENS, max_tokens: int = MAX_TOKENS, overlap: int = OVERLAP_TOKENS) -> list[Chunk]:
    flat: list[Block] = []
    for b in blocks:
        flat.extend(_split_oversized(b, max_tokens))
    chunks: list[Chunk] = []
    cur: list[Block] = []
    cur_tokens = 0

    def emit():
        nonlocal cur, cur_tokens
        if not cur:
            return
        text = "\n\n".join(b.text for b in cur).strip()
        if text:
            chunks.append(Chunk(len(chunks), text, cur[-1].section if cur else "", min(b.page for b in cur), max(b.page for b in cur), tok(text)))
        cur, cur_tokens = [], 0

    for b in flat:
        bt = tok(b.text)
        new_section = bool(cur) and b.section != cur[-1].section
        if cur and (cur_tokens + bt > max_tokens or (new_section and cur_tokens >= MIN_TOKENS) or cur_tokens >= target):
            prev_text = "\n\n".join(x.text for x in cur)
            prev_section = cur[-1].section
            prev_page = cur[-1].page
            emit()
            # sentence-aligned overlap only within the same section
            if b.section == prev_section and not b.is_table and not b.is_code:
                tail = _overlap_tail(prev_text, overlap)
                if tail:
                    cur = [Block(tail, prev_page, prev_section)]
                    cur_tokens = tok(tail)
        cur.append(b)
        cur_tokens += bt
    emit()
    return merge_tiny(chunks)


def merge_tiny(chunks: list[Chunk]) -> list[Chunk]:
    """Merge a trailing tiny chunk into its predecessor."""
    out: list[Chunk] = []
    for c in chunks:
        if out and c.tokens < 40 and out[-1].tokens + c.tokens <= MAX_TOKENS + 80:
            p = out[-1]
            p.text = p.text + "\n\n" + c.text
            p.page_end = max(p.page_end, c.page_end)
            p.tokens += c.tokens
        else:
            out.append(c)
    for i, c in enumerate(out):
        c.index = i
    return out


def embedding_text(doc_title: str, c: Chunk) -> str:
    """Contextual header used for embedding only; stored content stays clean (blueprint 9.1.5)."""
    head = doc_title if not c.section_path else f"{doc_title} › {c.section_path}"
    return f"{head}\n\n{c.text}"
