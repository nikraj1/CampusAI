"""Career Agent: tool-using agent over the student's profile, resume, job descriptions, skill gaps and study materials."""
from __future__ import annotations

import uuid
from typing import AsyncIterator

from .. import db
from ..rag.retrieval import search_documents
from ..workflows import career as wf
from . import prompts as P
from .base import Ctx, Event, history_messages, stream_answer
from .toolloop import Observation, Tool, observations_block, run_tools


def build_tools(ctx: Ctx) -> dict[str, Tool]:
    uid = uuid.UUID(ctx.user_id)

    async def get_profile():
        p = await db.fetchrow("select college, degree, branch, graduation_year, target_role, experience_level from app.user_profiles where user_id=$1", uid)
        sk = await db.fetch("select skill, source from app.user_skills where user_id=$1 order by skill limit 60", uid)
        return {"profile": dict(p) if p else {}, "skills": [r["skill"] for r in sk]}

    async def get_resume():
        r = await db.fetchrow("select id, label, parsed, parse_status from app.resumes where user_id=$1 order by is_primary desc, created_at desc limit 1", uid)
        if not r:
            return {"error": "No resume uploaded yet."}
        if r["parse_status"] != "PARSED":
            return {"error": f"Resume status is {r['parse_status']}."}
        p = r["parsed"]
        a = await db.fetchrow("select overall_score, result from app.resume_analyses where resume_id=$1 and type='GENERAL' order by created_at desc limit 1", r["id"])
        return {"resumeId": str(r["id"]), "label": r["label"], "skills": [s["name"] for s in p.get("skills", [])], "education": p.get("education", [])[:3],
                "projects": [x.get("name") for x in p.get("projects", [])][:6], "experience": [f"{x.get('role')} @ {x.get('company')}" for x in p.get("experience", [])][:5],
                "bulletCount": len(p.get("bullets", [])), "latestReviewScore": a["overall_score"] if a else None,
                "failedChecks": [c["detail"] for c in (a["result"].get("checks", []) if a else []) if not c["passed"]][:6]}

    async def list_job_descriptions():
        rows = await db.fetch("select id, title, company, parsed from app.job_descriptions where user_id=$1 order by created_at desc limit 8", uid)
        return {"jobDescriptions": [{"id": str(r["id"]), "title": r["title"], "company": r["company"], "required": [s["name"] for s in (r["parsed"] or {}).get("requiredSkills", [])][:12]} for r in rows]}

    async def match_resume_to_jd(jd_id: str | None = None):
        r = await db.fetchrow("select id, parsed, raw_text, parse_status from app.resumes where user_id=$1 order by is_primary desc, created_at desc limit 1", uid)
        if not r or r["parse_status"] != "PARSED":
            return {"error": "No parsed resume available."}
        if jd_id and jd_id not in ("null", "latest"):
            j = await db.fetchrow("select id, title, parsed from app.job_descriptions where id=$1 and user_id=$2", uuid.UUID(jd_id), uid)
        else:
            j = await db.fetchrow("select id, title, parsed from app.job_descriptions where user_id=$1 order by created_at desc limit 1", uid)
        if not j:
            return {"error": "No job description saved. Ask the student to add one under Career AI > Jobs."}
        m = await wf.match_resume_jd(ctx.user_id, {"parsed": r["parsed"], "raw_text": r["raw_text"]}, {"parsed": j["parsed"]})
        return {"job": j["title"], "matchScore": m["matchScore"], "matchedSkills": [x["skill"] for x in m["matchedSkills"]],
                "missingRequired": [{"skill": x["skill"], "inStudyMaterials": x["inStudyMaterials"], "material": x.get("material")} for x in m["missingRequired"]],
                "missingPreferred": [x["skill"] for x in m["missingPreferred"]]}

    async def find_study_material(query: str):
        hits = await search_documents(ctx.user_id, str(query), top_k=3)
        return {"results": [{"document": h.title, "pages": f"{h.page_start}-{h.page_end}", "relevance": round(h.dense, 2), "snippet": h.content[:200]} for h in hits if h.dense >= 0.45]}

    async def get_roadmap_progress():
        rows = await db.fetch("""select r.id, r.target_role, count(i.*) total, count(i.*) filter (where i.status='DONE') done
                                 from app.career_roadmaps r left join app.roadmap_items i on i.roadmap_id=r.id where r.user_id=$1 and r.status='ACTIVE' group by r.id""", uid)
        return {"roadmaps": [{"targetRole": r["target_role"], "done": r["done"], "total": r["total"]} for r in rows]}

    ts = [
        Tool("get_profile", "Student's profile fields and known skills", "", get_profile),
        Tool("get_resume", "Primary resume summary: skills, projects, experience, latest review score and failed checks", "", get_resume),
        Tool("list_job_descriptions", "Saved job descriptions with required skills", "", list_job_descriptions),
        Tool("match_resume_to_jd", "Compute match score, matched and missing skills between the primary resume and a JD (default: latest)", "jd_id?: string", match_resume_to_jd),
        Tool("find_study_material", "Search the student's own uploaded study documents for a topic/skill", "query: string", find_study_material),
        Tool("get_roadmap_progress", "Progress on active career roadmaps", "", get_roadmap_progress),
    ]
    return {t.name: t for t in ts}


async def run(ctx: Ctx) -> AsyncIterator[Event]:
    ctx.agent = "career"
    yield Event("status", {"text": "Looking at your career data…"})
    obs: list[Observation] = []
    tools = build_tools(ctx)
    extra = "Typical flow: get_resume and/or list_job_descriptions, then match_resume_to_jd for readiness/gap questions, then find_study_material for each important missing skill."
    async for e in run_tools(ctx, "Career Agent", tools, extra, obs):
        yield e
    msgs = [{"role": "system", "content": P.CAREER_FINAL_V1.format(profile=ctx.profile)}] + history_messages(ctx, 4) + [
        {"role": "user", "content": f"TOOL RESULTS:\n{observations_block(obs)}\n\nSTUDENT MESSAGE: {ctx.content}"}]
    yield Event("status", {"text": "Writing the answer…"})
    async for e in stream_answer(ctx, msgs, tier="quality", node="career_answer", prompt_version="career_final.v1"):
        yield e
    for o in obs:
        if o.tool == "match_resume_to_jd" and '"missingRequired"' in o.result and '"inStudyMaterials": false' in o.result:
            ctx.actions.append({"type": "open_page", "label": "Create a learning roadmap", "path": "/app/career/roadmaps"})
            break
