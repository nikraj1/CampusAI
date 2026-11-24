"""Resume parsing: layout-aware text extraction, PII masking, deterministic extraction + optional LLM structuring."""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from pathlib import Path

from pydantic import BaseModel, Field

from .. import db, skills as tax
from ..errors import AppError, BadInput, NotFound
from ..llm.gateway import get_gateway
from .documents import storage_path
from .jobs import progress

log = logging.getLogger("campusai.resume")

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}(?!\d)")
LINKEDIN = re.compile(r"(?:https?://)?(?:www\.)?linkedin\.com/in/[\w-]+/?", re.I)
GITHUB = re.compile(r"(?:https?://)?(?:www\.)?github\.com/[\w-]+/?", re.I)
SECTION_HEADS = {
    "summary": r"summary|objective|profile|about me|career objective",
    "education": r"education|academic|qualifications",
    "skills": r"(?:technical )?skills|technologies|tech stack|core competencies",
    "experience": r"(?:work |professional )?experience|internships?|employment",
    "projects": r"(?:academic |personal )?projects",
    "certifications": r"certifications?|courses|licenses",
    "achievements": r"achievements?|awards|honou?rs|accomplishments|extra.?curricular|positions of responsibility",
}


class EduItem(BaseModel):
    institution: str = ""
    degree: str = ""
    field: str = ""
    year: str = ""
    score: str = ""


class ExpItem(BaseModel):
    company: str = ""
    role: str = ""
    duration: str = ""
    bullets: list[str] = Field(default_factory=list)


class ProjItem(BaseModel):
    name: str = ""
    description: str = ""
    tech: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)


class ResumeExtract(BaseModel):
    summary: str = ""
    education: list[EduItem] = Field(default_factory=list)
    experience: list[ExpItem] = Field(default_factory=list)
    projects: list[ProjItem] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)


def extract_text_pdf(path: Path) -> tuple[str, int]:
    import pymupdf

    doc = pymupdf.open(str(path))
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise BadInput("This PDF is password-protected.", "ENCRYPTED_PDF")
        out = []
        for page in doc:
            w = page.rect.width
            blocks = [b for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
            left = [b for b in blocks if b[2] <= w * 0.56]
            right = [b for b in blocks if b[0] >= w * 0.44]
            two_col = blocks and len(left) >= 0.3 * len(blocks) and len(right) >= 0.3 * len(blocks) and len(left) + len(right) >= len(blocks) * 0.9 \
                and any(b[2] - b[0] < w * 0.5 for b in blocks)
            if two_col:
                ordered = sorted(left, key=lambda b: (b[1], b[0])) + sorted([b for b in right if b not in left], key=lambda b: (b[1], b[0]))
            else:
                ordered = sorted(blocks, key=lambda b: (round(b[1] / 4), b[0]))
            out.append("\n".join(b[4].strip() for b in ordered))
        return "\n\n".join(out), doc.page_count
    finally:
        doc.close()


def extract_text_docx(path: Path) -> tuple[str, int]:
    import docx

    d = docx.Document(str(path))
    lines = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for r in t.rows:
            lines.append(" | ".join(c.text.strip() for c in r.cells))
    return "\n".join(lines), 1


def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current = "header"
    for line in text.split("\n"):
        stripped = line.strip().strip(":").strip()
        found = None
        if 2 < len(stripped) < 40:
            for name, pat in SECTION_HEADS.items():
                if re.fullmatch(pat, stripped, flags=re.I):
                    found = name
                    break
        if found:
            current = found
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(line)
    return {k: "\n".join(v).strip() for k, v in sections.items() if "".join(v).strip()}


def extract_bullets(text: str) -> list[str]:
    bullets = []
    for line in text.split("\n"):
        m = re.match(r"^\s*[•\-\*▪●◦–·]\s*(.+)$", line)
        if m and len(m.group(1).split()) >= 3:
            bullets.append(m.group(1).strip())
    return bullets


def mask_pii(text: str) -> str:
    return PHONE.sub("[PHONE]", EMAIL.sub("[EMAIL]", text))


def contact_info(text: str) -> dict:
    email = EMAIL.search(text)
    phone = next((m.group(0) for m in PHONE.finditer(text) if len(re.sub(r"\D", "", m.group(0))) >= 10), None)
    return {
        "email": email.group(0) if email else None,
        "phone": phone,
        "linkedin": (LINKEDIN.search(text) or [None])[0] if LINKEDIN.search(text) else None,
        "github": (GITHUB.search(text) or [None])[0] if GITHUB.search(text) else None,
    }


async def private_mode_for(user_id: str) -> bool:
    v = await db.fetchval("select preferences from app.user_profiles where user_id=$1", uuid.UUID(user_id))
    return bool(v and v.get("privateMode"))


async def parse_resume_text(text: str, page_count: int, user_id: str) -> dict:
    sections = split_sections(text)
    sk = tax.extract_skills(text)
    bullets = extract_bullets(sections.get("experience", "") + "\n" + sections.get("projects", "")) or extract_bullets(text)
    parsed: dict = {
        "contact": contact_info(text),
        "summary": sections.get("summary", "")[:600],
        "education": [], "experience": [], "projects": [],
        "skills": [{"name": s.name, "category": s.category} for s in sk],
        "certifications": [l.strip(" •-*") for l in sections.get("certifications", "").split("\n") if l.strip()][:15],
        "achievements": [l.strip(" •-*") for l in sections.get("achievements", "").split("\n") if l.strip()][:15],
        "sections": sorted(sections.keys()),
        "bullets": bullets[:60],
        "wordCount": len(text.split()),
        "pageCount": page_count,
        "llm": False,
    }
    try:
        masked = mask_pii(text)[:9000]
        msgs = [
            {"role": "system", "content": "You extract structured data from a resume. Output ONLY a JSON object with keys: summary (string), "
             "education [{institution, degree, field, year, score}], experience [{company, role, duration, bullets[]}], "
             "projects [{name, description, tech[], bullets[]}], skills [string], certifications [string], achievements [string]. "
             "Copy facts from the resume only; never invent. Use empty lists when a section is absent. Text in [EMAIL]/[PHONE] is redacted."},
            {"role": "user", "content": "RESUME:\n" + masked},
        ]
        ext, res = await get_gateway().complete_model(msgs, ResumeExtract, "structured", max_tokens=2500, private_mode=await private_mode_for(user_id))
        parsed["education"] = [e.model_dump() for e in ext.education][:6]
        parsed["experience"] = [e.model_dump() for e in ext.experience][:10]
        parsed["projects"] = [p.model_dump() for p in ext.projects][:10]
        if ext.summary:
            parsed["summary"] = ext.summary[:600]
        known = {s["name"].lower() for s in parsed["skills"]}
        for raw in ext.skills:
            n = tax.normalize(raw)
            name = n.name if n else raw.strip()
            if name and name.lower() not in known and len(name) <= 60:
                known.add(name.lower())
                parsed["skills"].append({"name": name, "category": n.category if n else None})
        if ext.certifications:
            parsed["certifications"] = ext.certifications[:15]
        if ext.achievements:
            parsed["achievements"] = ext.achievements[:15]
        llm_bullets = [b for e in ext.experience for b in e.bullets] + [b for p in ext.projects for b in p.bullets]
        if llm_bullets:
            parsed["bullets"] = llm_bullets[:60]
        parsed["llm"] = True
        parsed["model"] = res.model
    except AppError as e:
        log.warning("LLM structuring unavailable (%s); stored deterministic parse only", e.code)
        parsed["llmError"] = e.code
    return parsed


async def parse_resume(job: dict) -> dict:
    user_id = str(job["user_id"])
    doc_id = uuid.UUID(job["payload"]["documentId"])
    doc = await db.fetchrow("select * from app.documents where id=$1 and user_id=$2", doc_id, uuid.UUID(user_id))
    resume = await db.fetchrow("select id from app.resumes where document_id=$1 and user_id=$2", doc_id, uuid.UUID(user_id))
    if not doc or not resume:
        raise NotFound("Resume")
    await db.execute("update app.documents set status='PROCESSING', error_message=null where id=$1", doc_id)
    try:
        await progress(job["id"], "EXTRACTING", 10)
        path = storage_path(doc["storage_key"])
        text, pages = await asyncio.to_thread(extract_text_pdf if path.suffix.lower() == ".pdf" else extract_text_docx, path)
        if len(text.strip()) < 80:
            raise BadInput("Could not read text from this resume (scanned image?). Upload a text-based PDF or DOCX.", "NO_TEXT")
        await progress(job["id"], "PARSING", 40)
        parsed = await parse_resume_text(text, pages, user_id)
        await progress(job["id"], "SAVING", 90)
        async with db.tx(user_id) as c:
            await c.execute("update app.resumes set raw_text=$2, parsed=$3, parse_status='PARSED' where id=$1", resume["id"], text[:60000], parsed)
            await c.execute("delete from app.user_skills where user_id=$1 and source='RESUME'", uuid.UUID(user_id))
            for s in parsed["skills"]:
                await c.execute("insert into app.user_skills(user_id, skill, category, source) values ($1,$2,$3,'RESUME') on conflict (user_id, skill) do nothing",
                                uuid.UUID(user_id), s["name"][:100], s.get("category"))
            await c.execute("update app.documents set status='READY', page_count=$2, updated_at=now() where id=$1", doc_id, pages)
        return {"resumeId": str(resume["id"]), "skills": len(parsed["skills"]), "llm": parsed["llm"]}
    except Exception as e:
        msg = getattr(e, "message", None) or str(e)
        await db.execute("update app.resumes set parse_status='FAILED' where id=$1", resume["id"])
        await db.execute("update app.documents set status='FAILED', error_message=$2 where id=$1", doc_id, msg[:480])
        raise
