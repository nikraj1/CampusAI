"""Career workflows: JD parsing, resume analysis & matching, roadmap, interview plan/evaluate/report, question bank.
Scores are computed by deterministic rules; the LLM only adds language (suggestions, rewrites, structuring). Everything degrades
gracefully when no LLM is available (blueprint 9.2)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from pydantic import BaseModel, Field

from .. import db, skills as tax
from ..embeddings import cosine, get_embedder
from ..errors import AppError, BadInput, NotFound
from ..ingestion.resume import mask_pii, private_mode_for
from ..llm.gateway import get_gateway
from ..rag.retrieval import search_documents

log = logging.getLogger("campusai.career")
ACTION_VERBS = {"built", "developed", "designed", "implemented", "created", "led", "managed", "optimized", "optimised", "reduced", "increased", "improved",
                "automated", "deployed", "integrated", "architected", "engineered", "launched", "analyzed", "analysed", "migrated", "refactored", "delivered",
                "established", "streamlined", "trained", "tested", "collaborated", "researched", "wrote", "configured", "secured", "mentored", "achieved", "won"}
METRIC = re.compile(r"\d+(?:\.\d+)?\s*(?:%|x|k\b|ms|s\b|users|requests|rps|hrs|hours|mb|gb|\+)|\b\d{2,}\b|\$\s?\d+|₹\s?\d+", re.I)
PREFERRED_MARK = re.compile(r"\b(preferred|nice to have|good to have|bonus|a plus|is a plus|desirable|added advantage|optional)\b", re.I)


# ---------------- JD parsing ----------------
class JDExtract(BaseModel):
    title: str = ""
    company: str = ""
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    minExperienceYears: float | None = None
    education: str = ""


def _norm_skill(s: str) -> tuple[str, str | None]:
    n = tax.normalize(s)
    return (n.name, n.category) if n else (s.strip()[:60], None)


def deterministic_jd(raw: str) -> dict:
    m = PREFERRED_MARK.search(raw)
    split = m.start() if m else len(raw)
    req = [s for s in tax.extract_skills(raw[:split])]
    pref = [s for s in tax.extract_skills(raw[split:]) if s.name not in {r.name for r in req}] if m else []
    exp = re.search(r"(\d+)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)", raw, re.I)
    resp = [re.sub(r"^[\s•\-\*\d.)]+", "", ln).strip() for ln in raw.split("\n") if re.match(r"^\s*[•\-\*▪●]|^\s*\d+[.)]\s", ln)]
    first = next((ln.strip() for ln in raw.split("\n") if ln.strip()), "")
    return {
        "title": first[:100] if len(first) < 100 else "", "company": "",
        "requiredSkills": [{"name": s.name, "category": s.category} for s in req],
        "preferredSkills": [{"name": s.name, "category": s.category} for s in pref],
        "responsibilities": [r for r in resp if len(r.split()) >= 4][:15],
        "minExperienceYears": float(exp.group(1)) if exp else None, "education": "", "keywords": [], "llm": False,
    }


async def parse_jd(user_id: str, raw: str) -> dict:
    parsed = deterministic_jd(raw)
    try:
        msgs = [{"role": "system", "content": "Extract a job description into JSON: {title, company, requiredSkills[], preferredSkills[], responsibilities[] (max 12 short items), "
                 "minExperienceYears (number|null), education}. requiredSkills = must-have technologies/skills; preferredSkills = nice-to-have. "
                 "Use only the text; use empty string/list when absent. Skill names should be short (e.g. 'Spring Boot', 'SQL')."},
                {"role": "user", "content": raw[:9000]}]
        ext, res = await get_gateway().complete_model(msgs, JDExtract, "structured", max_tokens=1200, private_mode=await private_mode_for(user_id))
        req, pref = {}, {}
        for s in ext.requiredSkills:
            n, c = _norm_skill(s)
            req[n] = c
        for s in parsed["requiredSkills"]:
            req.setdefault(s["name"], s["category"])
        for s in ext.preferredSkills:
            n, c = _norm_skill(s)
            if n not in req:
                pref[n] = c
        for s in parsed["preferredSkills"]:
            if s["name"] not in req:
                pref.setdefault(s["name"], s["category"])
        parsed.update({
            "title": ext.title or parsed["title"], "company": ext.company, "requiredSkills": [{"name": k, "category": v} for k, v in req.items()][:30],
            "preferredSkills": [{"name": k, "category": v} for k, v in pref.items()][:20], "responsibilities": ext.responsibilities[:12] or parsed["responsibilities"],
            "minExperienceYears": ext.minExperienceYears if ext.minExperienceYears is not None else parsed["minExperienceYears"],
            "education": ext.education, "llm": True, "model": res.model})
    except AppError as e:
        parsed["llmError"] = e.code
    return parsed


# ---------------- resume analysis ----------------
def resume_checks(parsed: dict, raw: str) -> list[dict]:
    bullets = parsed.get("bullets") or []
    secs = set(parsed.get("sections") or [])
    c = parsed.get("contact") or {}
    n_b = len(bullets)
    metric_b = sum(1 for b in bullets if METRIC.search(b))
    verb_b = sum(1 for b in bullets if b.split()[0].lower().strip(",.") in ACTION_VERBS)
    first_person = len(re.findall(r"\b(I|my|me)\b", raw))
    checks = [
        {"id": "CONTACT", "passed": bool(c.get("email")) and bool(c.get("phone")), "detail": "Email and phone number " + ("found" if c.get("email") and c.get("phone") else "missing or not detected")},
        {"id": "LINKS", "passed": bool(c.get("linkedin") or c.get("github")), "detail": "LinkedIn/GitHub link " + ("found" if c.get("linkedin") or c.get("github") else "missing - add your GitHub or LinkedIn profile")},
        {"id": "SECTION_EDUCATION", "passed": "education" in secs, "detail": "Education section " + ("present" if "education" in secs else "not detected")},
        {"id": "SECTION_SKILLS", "passed": "skills" in secs, "detail": "Skills section " + ("present" if "skills" in secs else "not detected")},
        {"id": "SECTION_EXPERIENCE_OR_PROJECTS", "passed": bool(secs & {"experience", "projects"}), "detail": "Experience/Projects " + ("present" if secs & {"experience", "projects"} else "not detected")},
        {"id": "LENGTH", "passed": (parsed.get("pageCount") or 1) <= 2 and 150 <= (parsed.get("wordCount") or 0) <= 1100,
         "detail": f"{parsed.get('pageCount', 1)} page(s), {parsed.get('wordCount', 0)} words (fresher resumes work best at 1 page, 250-700 words)"},
        {"id": "QUANTIFIED_BULLETS", "passed": n_b > 0 and metric_b / max(1, n_b) >= 0.3, "detail": f"{metric_b} of {n_b} bullets contain metrics (aim for 30%+)"},
        {"id": "ACTION_VERBS", "passed": n_b > 0 and verb_b / max(1, n_b) >= 0.5, "detail": f"{verb_b} of {n_b} bullets start with a strong action verb"},
        {"id": "NO_FIRST_PERSON", "passed": first_person <= 2, "detail": "Avoid first-person pronouns (I, my)" if first_person > 2 else "No first-person pronouns"},
        {"id": "SKILL_BREADTH", "passed": len(parsed.get("skills") or []) >= 8, "detail": f"{len(parsed.get('skills') or [])} recognised skills"},
    ]
    return checks


def section_scores(parsed: dict, checks: list[dict]) -> dict:
    by = {c["id"]: c["passed"] for c in checks}
    bullets = parsed.get("bullets") or []
    n_b = max(1, len(bullets))
    metric = sum(1 for b in bullets if METRIC.search(b)) / n_b
    verbs = sum(1 for b in bullets if b.split()[0].lower().strip(",.") in ACTION_VERBS) / n_b
    structure = 100 * sum([by["SECTION_EDUCATION"], by["SECTION_SKILLS"], by["SECTION_EXPERIENCE_OR_PROJECTS"], by["CONTACT"]]) / 4
    impact = 100 * min(1.0, 0.55 * min(1.0, metric / 0.4) + 0.45 * min(1.0, verbs / 0.7)) if bullets else 10
    skills = min(100, 100 * len(parsed.get("skills") or []) / 12)
    pe = len(parsed.get("projects") or []) + len(parsed.get("experience") or [])
    proj_exp = min(100, (40 if by["SECTION_EXPERIENCE_OR_PROJECTS"] else 0) + 20 * min(3, pe) + (0 if not bullets else min(20, len(bullets) * 2)))
    ats = 100 * sum([by["CONTACT"], by["LENGTH"], by["LINKS"], by["NO_FIRST_PERSON"]]) / 4
    return {"structure": round(structure), "impact": round(impact), "skills": round(skills), "projectsExperience": round(proj_exp), "atsReadability": round(ats)}


def overall(scores: dict) -> int:
    return round(0.20 * scores["structure"] + 0.25 * scores["impact"] + 0.20 * scores["skills"] + 0.25 * scores["projectsExperience"] + 0.10 * scores["atsReadability"])


def skill_evidence(skill: str, raw: str) -> str | None:
    n = tax.BY_NAME.get(skill.lower())
    terms = {skill.lower(), *(n.aliases if n else ())}
    for ln in raw.split("\n"):
        low = ln.lower()
        if any(t in low for t in terms if len(t) > 1) and len(ln.strip()) > 8:
            return ln.strip()[:140]
    return None


async def semantic_alignment(responsibilities: list[str], bullets: list[str]) -> float | None:
    if not responsibilities or not bullets:
        return None
    emb = get_embedder()
    rv = await emb.embed_plain([r[:300] for r in responsibilities[:12]])
    bv = await emb.embed_plain([b[:300] for b in bullets[:40]])
    best = [max(cosine(r, b) for b in bv) for r in rv]
    # map cosine (~0.35 unrelated .. ~0.8 strongly related) onto 0..1
    return max(0.0, min(1.0, (sum(best) / len(best) - 0.35) / 0.45))


async def match_resume_jd(user_id: str, resume: dict, jd: dict) -> dict:
    parsed = resume["parsed"] or {}
    have = {s["name"] for s in parsed.get("skills", [])}
    req = [s["name"] for s in jd["parsed"].get("requiredSkills", [])]
    pref = [s["name"] for s in jd["parsed"].get("preferredSkills", [])]
    raw = resume["raw_text"] or ""
    matched = [{"skill": s, "evidence": skill_evidence(s, raw), "importance": "REQUIRED" if s in req else "PREFERRED"} for s in req + pref if s in have]
    miss_req = [s for s in req if s not in have]
    miss_pref = [s for s in pref if s not in have]
    sim = await semantic_alignment(jd["parsed"].get("responsibilities", []), parsed.get("bullets", []))
    cov_req = (len(req) - len(miss_req)) / len(req) if req else None
    cov_pref = (len(pref) - len(miss_pref)) / len(pref) if pref else None
    parts, weights = [], []
    for v, w in ((cov_req, 0.6), (cov_pref, 0.2), (sim, 0.2)):
        if v is not None:
            parts.append(v * w)
            weights.append(w)
    score = round(100 * sum(parts) / sum(weights)) if weights else 0

    async def study(skill: str) -> dict:
        try:
            hits = await search_documents(user_id, skill, top_k=2)
            if hits and hits[0].dense >= 0.55:
                return {"inStudyMaterials": True, "material": {"title": hits[0].title, "pageStart": hits[0].page_start, "documentId": hits[0].document_id,
                                                                "topicId": hits[0].topic_id}}
        except Exception:  # noqa: BLE001
            pass
        return {"inStudyMaterials": False}

    mr = [{"skill": s, "importance": "REQUIRED", **(await study(s)), "resources": tax.resources_for(s)} for s in miss_req]
    mp = [{"skill": s, "importance": "PREFERRED", **(await study(s)), "resources": tax.resources_for(s)} for s in miss_pref]
    return {"matchScore": score, "matchedSkills": matched, "missingRequired": mr, "missingPreferred": mp, "responsibilityAlignment": None if sim is None else round(sim, 2),
            "coverage": {"required": cov_req, "preferred": cov_pref}}


class Suggestion(BaseModel):
    priority: str = "MEDIUM"
    section: str = ""
    text: str


class Rewrite(BaseModel):
    original: str
    improved: str


class ReviewOut(BaseModel):
    suggestions: list[Suggestion] = Field(default_factory=list)
    bulletRewrites: list[Rewrite] = Field(default_factory=list)


def fallback_suggestions(checks: list[dict], miss_req: list[dict]) -> list[dict]:
    tips = {
        "CONTACT": ("HIGH", "Header", "Add a professional email and phone number at the top."),
        "LINKS": ("MEDIUM", "Header", "Add links to your GitHub and LinkedIn profiles."),
        "SECTION_EDUCATION": ("HIGH", "Education", "Add a clearly labelled Education section with degree, college, year and CGPA."),
        "SECTION_SKILLS": ("MEDIUM", "Skills", "Add a Skills section grouped by category (languages, frameworks, databases, tools)."),
        "SECTION_EXPERIENCE_OR_PROJECTS": ("HIGH", "Projects", "Add Projects or Internships with 2-4 bullets each."),
        "LENGTH": ("LOW", "Overall", "Keep the resume to one page (two at most) and 250-700 words."),
        "QUANTIFIED_BULLETS": ("HIGH", "Experience", "Add metrics to bullets (users, latency, accuracy, % improvement, number of endpoints/tests)."),
        "ACTION_VERBS": ("MEDIUM", "Experience", "Start each bullet with a strong action verb: Built, Designed, Optimised, Deployed."),
        "NO_FIRST_PERSON": ("LOW", "Overall", "Remove first-person pronouns (I, my) from bullets."),
        "SKILL_BREADTH": ("MEDIUM", "Skills", "List more of the technologies you have actually used."),
    }
    out = [{"priority": tips[c["id"]][0], "section": tips[c["id"]][1], "text": tips[c["id"]][2]} for c in checks if not c["passed"] and c["id"] in tips]
    for m in miss_req[:3]:
        out.append({"priority": "HIGH", "section": "Skills", "text": f"The job requires {m['skill']}. If you have used it, add it with evidence; otherwise start learning it (see recommendations)."})
    return out


async def analyze(user_id: str, resume_id: str, jd_id: str | None) -> dict:
    r = await db.fetchrow("select id, parsed, raw_text, parse_status from app.resumes where id=$1 and user_id=$2", uuid.UUID(resume_id), uuid.UUID(user_id))
    if not r:
        raise NotFound("Resume")
    if r["parse_status"] != "PARSED" or not r["parsed"]:
        raise BadInput("Resume has not been parsed yet.", "RESUME_NOT_PARSED")
    parsed, raw = r["parsed"], r["raw_text"] or ""
    checks = resume_checks(parsed, raw)
    scores = section_scores(parsed, checks)
    result: dict[str, Any] = {"sectionScores": scores, "checks": checks, "llm": False}
    match = None
    jd_row = None
    if jd_id:
        jd_row = await db.fetchrow("select id, title, company, parsed from app.job_descriptions where id=$1 and user_id=$2", uuid.UUID(jd_id), uuid.UUID(user_id))
        if not jd_row:
            raise NotFound("Job description")
        match = await match_resume_jd(user_id, {"parsed": parsed, "raw_text": raw}, dict(jd_row))
        result.update({k: match[k] for k in ("matchedSkills", "missingRequired", "missingPreferred", "responsibilityAlignment", "coverage")})
    model_used = None
    try:
        facts = {"scores": scores, "failedChecks": [c["detail"] for c in checks if not c["passed"]],
                 "bullets": (parsed.get("bullets") or [])[:12], "missingRequired": [m["skill"] for m in (match or {}).get("missingRequired", [])],
                 "targetRole": jd_row["title"] if jd_row else None}
        msgs = [{"role": "system", "content": "You are a placement coach reviewing a B.Tech student's resume. From the FACTS give: suggestions (max 7, each {priority HIGH|MEDIUM|LOW, section, text}) "
                 "and bulletRewrites (max 4, each {original, improved}) where 'original' is copied EXACTLY from the given bullets and 'improved' keeps the same facts but uses a strong "
                 "verb and structure; NEVER invent metrics - use placeholders like [X%] if a number is missing. Output ONLY JSON {suggestions:[], bulletRewrites:[]}."},
                {"role": "user", "content": mask_pii(json.dumps(facts, ensure_ascii=False))}]
        out, res = await get_gateway().complete_model(msgs, ReviewOut, "structured", max_tokens=1500, private_mode=await private_mode_for(user_id))
        bullets = set(parsed.get("bullets") or [])
        result["suggestions"] = [s.model_dump() for s in out.suggestions][:8]
        result["bulletRewrites"] = [b.model_dump() for b in out.bulletRewrites if b.original in bullets][:5]
        result["llm"] = True
        model_used = res.model
    except AppError as e:
        result["suggestions"] = fallback_suggestions(checks, (match or {}).get("missingRequired", []))
        result["bulletRewrites"] = []
        result["llmError"] = e.code
    return {"type": "JD_MATCH" if match else "GENERAL", "overallScore": overall(scores), "matchScore": match["matchScore"] if match else None,
            "result": result, "model": model_used, "promptVersion": "career_review.v1"}


# ---------------- roadmap ----------------
class RItem(BaseModel):
    weekNo: int = 1
    title: str
    description: str = ""
    skill: str | None = None


class RoadmapOut(BaseModel):
    items: list[RItem] = Field(default_factory=list)


async def roadmap(user_id: str, target_role: str, analysis_id: str | None, weeks: int, hours: int) -> dict:
    gaps: list[str] = []
    if analysis_id:
        a = await db.fetchrow("select result from app.resume_analyses where id=$1 and user_id=$2", uuid.UUID(analysis_id), uuid.UUID(user_id))
        if not a:
            raise NotFound("Analysis")
        res = a["result"]
        gaps = [m["skill"] for m in res.get("missingRequired", [])] + [m["skill"] for m in res.get("missingPreferred", [])]
    if not gaps:
        have = {r["skill"] for r in await db.fetch("select skill from app.user_skills where user_id=$1", uuid.UUID(user_id))}
        base = {"backend": ["Spring Boot", "SQL", "REST APIs", "System Design", "Docker", "Data Structures"], "frontend": ["React", "TypeScript", "CSS", "REST APIs", "Testing"],
                "data": ["Python", "SQL", "Machine Learning", "Pandas"], "devops": ["Docker", "Kubernetes", "CI/CD", "Linux", "AWS"]}
        key = next((k for k in base if k in target_role.lower()), None)
        gaps = [s for s in (base.get(key) or ["Data Structures", "Algorithms", "System Design", "SQL", "Git"]) if s not in have]
    gaps = list(dict.fromkeys(gaps))[:10]
    if not gaps:
        gaps = ["System Design", "Algorithms"]
    items: list[dict] = []
    try:
        msgs = [{"role": "system", "content": f"Create a {weeks}-week study roadmap ({hours} hours/week) for a student targeting '{target_role}'. Cover ONLY these skills: {', '.join(gaps)}. "
                 "Output ONLY JSON {items:[{weekNo (1.." + str(weeks) + "), title, description (1-2 sentences, concrete deliverable), skill (exactly one of the listed skills)}]}. "
                 "2-3 items per week, ordered from fundamentals to a project/practice task. Do not include URLs."},
                {"role": "user", "content": f"Skills to cover: {gaps}"}]
        out, res = await get_gateway().complete_model(msgs, RoadmapOut, "structured", max_tokens=2500, private_mode=await private_mode_for(user_id))
        for it in out.items:
            sk = it.skill if it.skill in gaps else next((g for g in gaps if g.lower() in (it.title + it.description).lower()), None)
            items.append({"weekNo": max(1, min(weeks, it.weekNo)), "title": it.title[:190], "description": it.description[:500], "skill": sk})
    except AppError:
        pass
    if not items:  # deterministic fallback: spread skills over the weeks
        per_week = max(1, -(-len(gaps) * 2 // weeks))
        seq = []
        for g in gaps:
            seq.append((g, f"Learn the fundamentals of {g}", f"Work through the core concepts of {g} and take notes (~{max(2, hours // 2)}h)."))
            seq.append((g, f"Practice {g} with a mini-project", f"Build a small hands-on exercise using {g} and push it to GitHub."))
        for i, (g, t, d) in enumerate(seq):
            items.append({"weekNo": min(weeks, i // per_week + 1), "title": t, "description": d, "skill": g})
    out_items = []
    counters: dict[int, int] = {}
    for it in sorted(items, key=lambda x: x["weekNo"]):
        counters[it["weekNo"]] = counters.get(it["weekNo"], 0) + 1
        linked: list[str] = []
        if it["skill"]:
            try:
                hits = await search_documents(user_id, it["skill"], top_k=2)
                linked = [h.topic_id for h in hits if h.dense >= 0.55 and h.topic_id][:2]
            except Exception:  # noqa: BLE001
                linked = []
        out_items.append({**it, "orderIndex": counters[it["weekNo"]], "resources": tax.resources_for(it["skill"]) if it["skill"] else [], "linkedTopicIds": linked})
    return {"items": out_items}


# ---------------- interviews ----------------
class Q(BaseModel):
    category: str = "GENERAL"
    question: str
    difficulty: str = "MEDIUM"
    hint: str = ""
    modelAnswerOutline: str = ""


class QList(BaseModel):
    questions: list[Q] = Field(default_factory=list)


async def _context_for_interview(user_id: str, jd_id, resume_id) -> str:
    parts = []
    if jd_id:
        j = await db.fetchrow("select title, company, parsed from app.job_descriptions where id=$1 and user_id=$2", jd_id, uuid.UUID(user_id))
        if j:
            p = j["parsed"] or {}
            parts.append(f"JOB: {j['title']} at {j['company'] or 'n/a'}; required skills: {[s['name'] for s in p.get('requiredSkills', [])]}")
    if resume_id:
        r = await db.fetchrow("select parsed from app.resumes where id=$1 and user_id=$2", resume_id, uuid.UUID(user_id))
        if r and r["parsed"]:
            p = r["parsed"]
            parts.append(f"CANDIDATE skills: {[s['name'] for s in p.get('skills', [])][:15]}; projects: {[x.get('name') for x in p.get('projects', [])][:5]}")
    return "\n".join(parts)


async def question_bank(user_id: str, req: dict) -> dict:
    jd = uuid.UUID(req["jobDescriptionId"]) if req.get("jobDescriptionId") else None
    ctx = await _context_for_interview(user_id, jd, None)
    count = max(1, min(20, int(req.get("count", 10))))
    typ = str(req.get("type", "TECHNICAL")).upper()
    topic = req.get("topic") or ""
    msgs = [{"role": "system", "content": f"Generate {count} {typ.lower()} interview questions for a B.Tech fresher. Difficulty: {req.get('difficulty', 'MEDIUM')}. "
             "Output ONLY JSON {questions:[{category (e.g. DSA, OOP, DBMS, OS, NETWORKS, PROJECT, BEHAVIORAL), question, difficulty (EASY|MEDIUM|HARD), hint (1 line), modelAnswerOutline (2-3 bullet points as one string)}]}. "
             "Questions must be specific and distinct."},
            {"role": "user", "content": f"Topic focus: {topic or 'general'}\n{ctx}"}]
    out, res = await get_gateway().complete_model(msgs, QList, "structured", max_tokens=2500, private_mode=await private_mode_for(user_id))
    return {"questions": [q.model_dump() for q in out.questions][:count], "model": res.model}


async def interview_plan(user_id: str, session_id: str) -> dict:
    s = await db.fetchrow("select * from app.interview_sessions where id=$1 and user_id=$2", uuid.UUID(session_id), uuid.UUID(user_id))
    if not s:
        raise NotFound("Interview session")
    ctx = await _context_for_interview(user_id, s["job_description_id"], s["resume_id"])
    typ = s["type"]
    mix = {"TECHNICAL": "technical (DSA, OOP, DBMS, OS, networks, system basics, and the candidate's projects)", "HR": "HR/behavioural (use STAR-style prompts)",
           "MIXED": "a mix of technical and HR/behavioural"}[typ]
    msgs = [{"role": "system", "content": f"You are a mock interviewer. Plan exactly {s['planned_questions']} {mix} questions for the role '{s['target_role'] or 'Software Engineer (fresher)'}', "
             f"difficulty {s['difficulty']}. Order from warm-up to harder. Output ONLY JSON {{questions:[{{category, question}}]}}. Each question must be answerable verbally in 1-3 minutes."},
            {"role": "user", "content": ctx or "No resume or job description provided."}]
    out, res = await get_gateway().complete_model(msgs, QList, "structured", max_tokens=1500, private_mode=await private_mode_for(user_id))
    qs = [{"category": q.category, "question": q.question} for q in out.questions][: s["planned_questions"]]
    if not qs:
        raise BadInput("The model returned no questions.", "NO_QUESTIONS")
    return {"questions": qs, "model": res.model}


class Eval(BaseModel):
    correctness: float = 3
    depth: float = 3
    clarity: float = 3
    star: float | None = None
    feedback: str = ""
    needsFollowUp: bool = False
    followUpQuestion: str = ""


def _clamp5(v) -> float:
    try:
        return max(1.0, min(5.0, float(v)))
    except (TypeError, ValueError):
        return 3.0


async def interview_evaluate(user_id: str, session_id: str, question_id: str) -> dict:
    row = await db.fetchrow(
        """select q.id, q.question, q.answer, q.category, q.parent_id, s.type, s.target_role from app.interview_questions q
           join app.interview_sessions s on s.id=q.session_id where q.id=$1 and s.id=$2 and s.user_id=$3""",
        uuid.UUID(question_id), uuid.UUID(session_id), uuid.UUID(user_id))
    if not row or not row["answer"]:
        raise NotFound("Answered question")
    hr = row["type"] == "HR" or (row["category"] or "").upper() in ("BEHAVIORAL", "HR", "BEHAVIOURAL")
    msgs = [{"role": "system", "content": "You are a strict but fair interviewer. Score the candidate's answer 1-5 on correctness, depth, clarity" + (", and star (use of Situation-Task-Action-Result)" if hr else "") +
             ". Give 2-3 sentences of specific feedback, including what a stronger answer would add. If the answer is shallow or partly wrong and a probing question would help, set needsFollowUp=true "
             "and write ONE follow-up question. Output ONLY JSON {correctness, depth, clarity, star (number|null), feedback, needsFollowUp, followUpQuestion}."},
            {"role": "user", "content": f"ROLE: {row['target_role']}\nQUESTION ({row['category']}): {row['question']}\nCANDIDATE ANSWER:\n{row['answer'][:4000]}"}]
    ev, res = await get_gateway().complete_model(msgs, Eval, "structured", max_tokens=600, temperature=0.0, private_mode=await private_mode_for(user_id))
    scores = {"correctness": _clamp5(ev.correctness), "depth": _clamp5(ev.depth), "clarity": _clamp5(ev.clarity)}
    if hr and ev.star is not None:
        scores["star"] = _clamp5(ev.star)
    avg = sum(scores.values()) / len(scores)
    follow = None
    if ev.needsFollowUp and ev.followUpQuestion.strip() and row["parent_id"] is None and avg < 4.0:
        follow = {"question": ev.followUpQuestion.strip()}
    return {"scores": scores, "feedback": ev.feedback, "followUp": follow, "model": res.model}


class ReportOut(BaseModel):
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)


async def interview_report(user_id: str, session_id: str) -> dict:
    s = await db.fetchrow("select * from app.interview_sessions where id=$1 and user_id=$2", uuid.UUID(session_id), uuid.UUID(user_id))
    if not s:
        raise NotFound("Interview session")
    qs = await db.fetch("select category, question, answer, scores, feedback from app.interview_questions where session_id=$1 and scores is not null order by order_index", s["id"])
    if not qs:
        raise BadInput("No answered questions to report on.", "NO_ANSWERS")
    per_cat: dict[str, list[float]] = {}
    all_avgs = []
    for q in qs:
        vals = [float(v) for v in q["scores"].values()]
        a = sum(vals) / len(vals)
        all_avgs.append(a)
        per_cat.setdefault((q["category"] or "GENERAL").upper(), []).append(a)
    overall_score = round((sum(all_avgs) / len(all_avgs) - 1) / 4 * 100)
    per = {k: round((sum(v) / len(v) - 1) / 4 * 100) for k, v in per_cat.items()}
    strengths, improvements = [], []
    try:
        digest = [{"category": q["category"], "q": q["question"][:150], "scores": q["scores"], "feedback": (q["feedback"] or "")[:200]} for q in qs]
        msgs = [{"role": "system", "content": "Summarise a mock interview. Output ONLY JSON {strengths:[max 4 short bullets], improvements:[max 4 short, actionable bullets]} based strictly on the data."},
                {"role": "user", "content": json.dumps(digest, ensure_ascii=False)}]
        out, _ = await get_gateway().complete_model(msgs, ReportOut, "fast", max_tokens=500, private_mode=await private_mode_for(user_id))
        strengths, improvements = out.strengths[:4], out.improvements[:4]
    except AppError:
        pass
    if not strengths and not improvements:
        best = max(per.items(), key=lambda x: x[1])
        worst = min(per.items(), key=lambda x: x[1])
        strengths = [f"Strongest area: {best[0]} ({best[1]}/100)"]
        improvements = [f"Practise more {worst[0]} questions (scored {worst[1]}/100)"]
    return {"overallScore": overall_score, "report": {"strengths": strengths, "improvements": improvements, "perCategory": per, "answered": len(qs)}}
