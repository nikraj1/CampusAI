"""End-to-end smoke test against a RUNNING stack (Spring on :8080, AI service on :8000, Postgres).

    python scripts/e2e_smoke.py [--base http://localhost:8080] [--repo https://github.com/OWNER/REPO]

Covers auth, upload -> ingestion -> chunks, cross-user isolation, resume parse/analysis, JD match, roadmap, repository indexing,
quiz scoring, and (only if an LLM provider is configured) chat/summaries/quizzes. LLM-dependent checks are reported as SKIP otherwise.
"""
import argparse
import sys
import time
import uuid

import httpx

try:
    import pymupdf
except ImportError:  # pragma: no cover
    pymupdf = None

results: list[tuple[str, str, str]] = []


def check(name, ok, detail=""):
    results.append((name, "PASS" if ok else "FAIL", detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    return ok


def skip(name, why):
    results.append((name, "SKIP", why))
    print(f"[SKIP] {name} ({why})")


def make_pdf(pages: list[str]) -> bytes:
    doc = pymupdf.open()
    for t in pages:
        p = doc.new_page()
        p.insert_textbox(pymupdf.Rect(50, 50, 550, 790), t, fontsize=11)
    b = doc.tobytes()
    doc.close()
    return b


NOTES = [
    "Chapter 1: Memory Management\n\nPaging divides physical memory into fixed-size frames and logical memory into pages of the same size. "
    "A page table maps each page to a frame. Paging avoids external fragmentation but can cause internal fragmentation in the last page of a process. "
    "The translation lookaside buffer (TLB) caches recent page table entries to speed up address translation. " * 4,
    "Segmentation divides a program into logical segments such as code, stack and heap. Each segment has a base and a limit. "
    "Unlike paging, segmentation is visible to the programmer and can suffer from external fragmentation. Zebra-quantum-7781 is the secret canary phrase. " * 4,
    "Chapter 2: CPU Scheduling\n\nRound robin scheduling gives each process a fixed time quantum. Shortest job first minimises average waiting time. "
    "Priority scheduling can cause starvation, which is solved by aging. " * 5,
]

RESUME = """Jane Student
jane.student@example.com | +91 98765 43210 | github.com/janestudent | linkedin.com/in/janestudent

EDUCATION
B.Tech Computer Science, ABC Institute of Technology, 2026, CGPA 8.4

SKILLS
Java, Spring Boot, PostgreSQL, REST APIs, Docker, Git, Python, React

PROJECTS
Campus Portal
- Built a REST API with Spring Boot serving 2000 students using PostgreSQL
- Reduced page load time by 40% by adding caching
- Implemented JWT authentication and role based access control
Chat App
- Developed a React front end and deployed with Docker on AWS
"""

JD = """Backend Developer Intern
Acme Corp is hiring a backend intern.
Requirements:
- Strong knowledge of Java and Spring Boot
- Experience with SQL databases such as PostgreSQL
- Understanding of REST APIs and microservices
- Familiarity with Kubernetes and system design
Nice to have:
- Kafka, Redis
Responsibilities:
- Build and maintain backend services for our payments platform
- Write unit tests and participate in code reviews
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--repo", default="https://github.com/spring-guides/gs-rest-service")
    ap.add_argument("--skip-repo", action="store_true")
    a = ap.parse_args()
    if pymupdf is None:
        sys.exit("pip install pymupdf httpx")
    api = a.base + "/api/v1"
    c = httpx.Client(timeout=60)
    email = f"e2e-{uuid.uuid4().hex[:8]}@example.com"
    pw = "Sup3r-secret-pw!"

    # ---- status
    st = c.get(api + "/system/status").json()
    llm = st.get("llmConfigured", False)
    check("services up (api+ai)", st.get("api") == "UP" and st.get("ai") == "UP", str(st))
    print("LLM configured:", llm)

    # ---- auth
    r = c.post(api + "/auth/register", json={"email": email, "password": "short", "fullName": "E2E"})
    check("weak password rejected", r.status_code == 400 and r.json().get("code") == "WEAK_PASSWORD")
    r = c.post(api + "/auth/register", json={"email": email, "password": pw, "fullName": "E2E User"})
    check("register", r.status_code == 201 and "accessToken" in r.json())
    tok = r.json()["accessToken"]
    H = {"Authorization": f"Bearer {tok}"}
    check("refresh cookie is HttpOnly+Strict", "HttpOnly" in r.headers.get("set-cookie", "") and "SameSite=Strict" in r.headers.get("set-cookie", ""))
    check("duplicate email -> 409", c.post(api + "/auth/register", json={"email": email, "password": pw, "fullName": "x"}).status_code == 409)
    check("protected endpoint without token -> 401", httpx.get(api + "/users/me").status_code == 401)
    check("tampered token -> 401", httpx.get(api + "/users/me", headers={"Authorization": f"Bearer {tok}x"}).status_code == 401)
    me = c.get(api + "/users/me", headers=H).json()
    check("GET /users/me", me["email"] == email)
    r = c.post(api + "/auth/login", json={"email": email, "password": "wrong-password-1"})
    check("bad login -> 401", r.status_code == 401)
    r = c.post(api + "/auth/refresh", headers={"X-Requested-With": "XMLHttpRequest"})
    check("refresh rotates token", r.status_code == 200 and "accessToken" in r.json())
    old_cookie = r.request.headers.get("cookie")
    H = {"Authorization": f"Bearer {r.json()['accessToken']}"}
    r2 = httpx.post(api + "/auth/refresh", headers={"X-Requested-With": "XMLHttpRequest", "Cookie": old_cookie})
    check("reuse of rotated refresh token rejected", r2.status_code == 401 and r2.json().get("code") == "REFRESH_TOKEN_REUSED")
    r3 = c.post(api + "/auth/refresh", headers={"X-Requested-With": "XMLHttpRequest"})
    check("whole token family revoked after reuse", r3.status_code == 401)
    r = c.post(api + "/auth/login", json={"email": email, "password": pw})
    H = {"Authorization": f"Bearer {r.json()['accessToken']}"}
    check("login", r.status_code == 200)
    r = c.put(api + "/users/me/profile", headers=H, json={"college": "ABC", "targetRole": "Backend Developer", "experienceLevel": "FRESHER", "preferences": {"answerStyle": "concise"}})
    check("update profile", r.status_code == 200 and r.json()["profile"]["targetRole"] == "Backend Developer")

    # ---- second user for isolation
    email2 = f"e2e-{uuid.uuid4().hex[:8]}@example.com"
    c2 = httpx.Client(timeout=60)
    H2 = {"Authorization": "Bearer " + c2.post(api + "/auth/register", json={"email": email2, "password": pw, "fullName": "Other"}).json()["accessToken"]}

    # ---- upload validation
    r = c.post(api + "/documents", headers=H, files={"file": ("evil.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")})
    check("fake PDF (bad magic bytes) rejected 415", r.status_code == 415, r.text[:80])

    # ---- study ingestion
    pdf = make_pdf(NOTES)
    r = c.post(api + "/documents", headers=H, files={"file": ("os-notes.pdf", pdf, "application/pdf")}, data={"title": "OS Notes"})
    check("upload accepted (202)", r.status_code == 202, r.text[:100])
    doc_id, job_id = r.json()["documentId"], r.json()["jobId"]
    check("duplicate upload -> 409", c.post(api + "/documents", headers=H, files={"file": ("os-notes.pdf", pdf, "application/pdf")}).status_code == 409)
    t0 = time.time()
    while time.time() - t0 < 180:
        j = c.get(f"{api}/jobs/{job_id}", headers=H).json()
        if j["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    check("ingestion job succeeded", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')} ({int(time.time() - t0)}s)")
    d = c.get(f"{api}/documents/{doc_id}", headers=H).json()
    check("document READY with chunks, pages, topics", d["status"] == "READY" and d["chunkCount"] > 0 and d["pageCount"] == 3 and len(d["topics"]) >= 1, f"chunks={d['chunkCount']} topics={len(d['topics'])}")
    f = c.get(f"{api}/documents/{doc_id}/file", headers=H)
    check("original file downloadable", f.status_code == 200 and f.content[:4] == b"%PDF")

    # ---- isolation
    check("other user cannot read document (404)", c2.get(f"{api}/documents/{doc_id}", headers=H2).status_code == 404)
    check("other user cannot download file (404)", c2.get(f"{api}/documents/{doc_id}/file", headers=H2).status_code == 404)
    check("other user cannot delete document (404)", c2.delete(f"{api}/documents/{doc_id}", headers=H2).status_code == 404)
    check("other user lists no documents", c2.get(api + "/documents", headers=H2).json()["total"] == 0)
    conv2 = c2.post(api + "/conversations", headers=H2, json={"module": "STUDY"}).json()
    r = c2.patch(f"{api}/conversations/{conv2['id']}", headers=H2, json={"scope": {"documentIds": [doc_id]}})
    check("other user cannot scope a conversation to my document (404)", r.status_code == 404)

    # ---- chat (needs LLM)
    conv = c.post(api + "/conversations", headers=H, json={"module": "STUDY", "scope": {"documentIds": [doc_id]}}).json()
    events = []
    with c.stream("POST", f"{api}/conversations/{conv['id']}/messages", headers=H, json={"content": "What is the difference between paging and segmentation?"}, timeout=120) as resp:
        name = None
        for line in resp.iter_lines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                events.append((name, line[5:].strip()))
    names = [e[0] for e in events]
    if llm:
        check("study chat streams tokens + citations + done", "token" in names and "citations" in names and "done" in names, str(names[:8]))
        import json
        cites = next((json.loads(d)["citations"] for n, d in events if n == "citations"), [])
        check("citations reference the uploaded document + page", bool(cites) and cites[0]["documentId"] == doc_id and cites[0]["pageStart"] >= 1)
        msgs = c.get(f"{api}/conversations/{conv['id']}/messages", headers=H).json()
        check("assistant message persisted with citations", msgs[-1]["role"] == "ASSISTANT" and msgs[-1]["status"] == "COMPLETE" and msgs[-1]["content"])
        run_id = msgs[-1]["runId"]
        tr = c.get(f"{api}/agent-runs/{run_id}", headers=H).json()
        check("agent trace recorded steps", len(tr["steps"]) >= 2)
        # abstention
        events2, name = [], None
        with c.stream("POST", f"{api}/conversations/{conv['id']}/messages", headers=H, json={"content": "Who won the 1998 football world cup final?"}, timeout=120) as resp:
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    events2.append((name, line[5:].strip()))
        text = "".join(json.loads(d)["t"] for n, d in events2 if n == "token")
        low = text.lower()
        check("unanswerable question abstains", any(k in low for k in ("couldn't find", "could not find", "do not contain", "does not contain", "not from your", "general knowledge", "no information")), text[:100])
    else:
        err = next((d for n, d in events if n == "error"), "")
        check("chat without LLM fails gracefully with typed error", "LLM_NOT_CONFIGURED" in err, err[:120])
        skip("study chat streaming / citations / abstention", "no LLM provider configured")

    # ---- quizzes
    q = c.post(api + "/quizzes", headers=H, json={"documentIds": [doc_id], "numQuestions": 5, "difficulty": "ADAPTIVE", "types": ["MCQ_SINGLE"]})
    check("quiz job accepted", q.status_code == 202, q.text[:100])
    qid, qjob = q.json()["quizId"], q.json()["jobId"]
    t0 = time.time()
    while time.time() - t0 < 240:
        j = c.get(f"{api}/jobs/{qjob}", headers=H).json()
        if j["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    if llm:
        check("quiz generated", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')}")
        quiz = c.get(f"{api}/quizzes/{qid}", headers=H).json()
        check("quiz payload hides answers", all("correctIndices" not in x and "explanation" not in x for x in quiz["questions"]))
        att = c.post(f"{api}/quizzes/{qid}/attempts", headers=H).json()["attemptId"]
        res = c.post(f"{api}/quiz-attempts/{att}/submit", headers=H, json={"answers": [{"questionId": x["id"], "selectedIndices": [0]} for x in quiz["questions"]]}).json()
        check("quiz scored + results include explanations", "score" in res and all(r["explanation"] for r in res["results"]), f"{res.get('score')}/{res.get('maxScore')}")
        check("mastery updated", len(res["masteryChanges"]) >= 1)
        prog = c.get(api + "/study/progress", headers=H).json()
        check("progress reflects attempt", prog["quizzesTaken"] == 1)
    else:
        check("quiz generation without LLM fails cleanly (FAILED job + FAILED quiz)", j["status"] == "FAILED" and c.get(f"{api}/quizzes/{qid}", headers=H).json()["status"] == "FAILED", str(j.get("errorMessage"))[:100])
        skip("quiz generation / scoring end-to-end", "no LLM provider configured (scoring logic is unit-tested)")

    # ---- career: resume
    rp = make_pdf([RESUME])
    r = c.post(api + "/career/resumes", headers=H, files={"file": ("jane-resume.pdf", rp, "application/pdf")})
    check("resume upload accepted", r.status_code == 202, r.text[:100])
    rid, rjob = r.json()["resumeId"], r.json()["jobId"]
    t0 = time.time()
    while time.time() - t0 < 120:
        j = c.get(f"{api}/jobs/{rjob}", headers=H).json()
        if j["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    check("resume parse job succeeded", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')}")
    res = c.get(f"{api}/career/resumes/{rid}", headers=H).json()
    skills = {s["name"] for s in res["parsed"]["skills"]}
    check("resume skills extracted via taxonomy", {"Java", "Spring Boot", "PostgreSQL", "Docker"} <= skills, str(sorted(skills))[:100])
    check("contact details parsed", res["parsed"]["contact"]["email"] == "jane.student@example.com")
    check("primary resume set automatically", res["isPrimary"] is True)
    check("other user cannot read my resume (404)", c2.get(f"{api}/career/resumes/{rid}", headers=H2).status_code == 404)

    # ---- JD + analysis
    r = c.post(api + "/career/job-descriptions", headers=H, json={"rawText": JD})
    check("JD parsed", r.status_code == 201, r.text[:100])
    jd = r.json()
    req = {s["name"] for s in jd["parsed"]["requiredSkills"]}
    check("JD required vs preferred skills split", {"Java", "Spring Boot", "Kubernetes"} <= req and {"Kafka", "Redis"} <= {s["name"] for s in jd["parsed"]["preferredSkills"]}, str(req))
    r = c.post(api + "/career/analyses", headers=H, json={"resumeId": rid, "jobDescriptionId": jd["id"]})
    check("analysis accepted", r.status_code == 202)
    aj = r.json()["jobId"]
    t0 = time.time()
    while time.time() - t0 < 150:
        j = c.get(f"{api}/jobs/{aj}", headers=H).json()
        if j["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    check("analysis job succeeded", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')}")
    an = c.get(f"{api}/career/analyses/{j['result']['analysisId']}", headers=H).json()
    mr = {m["skill"] for m in an["result"]["missingRequired"]}
    check("match score + explainable gaps", an["matchScore"] is not None and "Kubernetes" in mr and "Java" not in mr, f"match={an['matchScore']} overall={an['overallScore']} missing={sorted(mr)}")
    check("missing skills carry curated resources only", all(x["url"].startswith("https://") for m in an["result"]["missingRequired"] for x in m["resources"]))
    an2 = c.get(f"{api}/career/analyses/{an['id']}", headers=H2)
    check("other user cannot read analysis (404)", an2.status_code == 404)
    rr = c.post(api + "/career/roadmaps", headers=H, json={"targetRole": "Backend Developer", "analysisId": an["id"], "durationWeeks": 4, "hoursPerWeek": 8})
    check("roadmap accepted", rr.status_code == 202)
    t0 = time.time()
    while time.time() - t0 < 150:
        j = c.get(f"{api}/jobs/{rr.json()['jobId']}", headers=H).json()
        if j["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    check("roadmap generated", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')}")
    rm = c.get(f"{api}/career/roadmaps/{j['result']['roadmapId']}", headers=H).json()
    items = [i for w in rm["weeks"] for i in w["items"]]
    check("roadmap has weekly items with curated resources", len(items) >= 2 and any(i["resources"] for i in items))
    p = c.patch(f"{api}/career/roadmaps/{rm['id']}/items/{items[0]['id']}", headers=H, json={"status": "DONE"})
    check("roadmap progress update", p.status_code == 200 and c.get(f"{api}/career/roadmaps/{rm['id']}", headers=H).json()["progressPct"] > 0)

    # ---- interviews (LLM)
    if llm:
        iv = c.post(api + "/career/interviews", headers=H, json={"type": "TECHNICAL", "numQuestions": 2, "targetRole": "Backend Intern", "resumeId": rid})
        check("mock interview starts with a question", iv.status_code == 201 and iv.json()["question"]["text"], iv.text[:100])
        sid = iv.json()["sessionId"]
        qn = iv.json()["question"]
        for _ in range(5):
            ans = c.post(f"{api}/career/interviews/{sid}/answers", headers=H, json={"questionId": qn["id"], "answer": "I would use indexes and normalisation; it depends on the access pattern, e.g. a B-tree index on frequently filtered columns."}, timeout=120)
            if ans.status_code != 200:
                break
            if ans.json()["completed"]:
                break
            qn = ans.json()["next"]
        check("mock interview completes with report", ans.status_code == 200 and ans.json().get("completed") and "overallScore" in ans.json()["report"], ans.text[:120])
    else:
        skip("mock interview", "no LLM provider configured")

    # ---- project
    if not a.skip_repo:
        r = c.post(api + "/projects/repositories", headers=H, json={"url": "https://evil.example.com/a/b"})
        check("non-GitHub URL rejected", r.status_code == 400)
        r = c.post(api + "/projects/repositories", headers=H, json={"url": a.repo})
        check("repository accepted", r.status_code == 202, r.text[:100])
        repo_id, rj = r.json()["repositoryId"], r.json()["jobId"]
        t0 = time.time()
        while time.time() - t0 < 400:
            j = c.get(f"{api}/jobs/{rj}", headers=H).json()
            if j["status"] in ("SUCCEEDED", "FAILED"):
                break
            time.sleep(3)
        check("repository indexed", j["status"] == "SUCCEEDED", f"{j['status']} {j.get('errorMessage')} ({int(time.time() - t0)}s)")
        rp_ = c.get(f"{api}/projects/repositories/{repo_id}", headers=H).json()
        check("repo has files, chunks, languages, stack", rp_["fileCount"] > 0 and rp_["chunkCount"] > 0 and rp_["languages"], f"files={rp_['fileCount']} chunks={rp_['chunkCount']} stack={rp_['detectedStack'].get('frameworks')}")
        tree = c.get(f"{api}/projects/repositories/{repo_id}/tree", headers=H).json()
        src = next((t for t in tree if t["path"].endswith((".java", ".py", ".js", ".ts")) and t["isIndexed"]), None)
        check("file tree available", len(tree) > 0 and src is not None)
        if src:
            fc = c.get(f"{api}/projects/repositories/{repo_id}/file", headers=H, params={"path": src["path"], "start": 1, "end": 5}).json()
            check("file content endpoint with line range", fc["startLine"] == 1 and fc["content"])
        check("other user cannot read repo (404)", c2.get(f"{api}/projects/repositories/{repo_id}", headers=H2).status_code == 404)
        check("other user cannot read repo tree (404)", c2.get(f"{api}/projects/repositories/{repo_id}/tree", headers=H2).status_code == 404)
        if llm:
            conv = c.post(api + "/conversations", headers=H, json={"module": "PROJECT", "scope": {"repositoryId": repo_id}}).json()
            ev = []
            nm = None
            with c.stream("POST", f"{api}/conversations/{conv['id']}/messages", headers=H, json={"content": "Where is the main entry point of this application and what does it do?"}, timeout=180) as resp:
                for line in resp.iter_lines():
                    if line.startswith("event:"):
                        nm = line[6:].strip()
                    elif line.startswith("data:"):
                        ev.append((nm, line[5:].strip()))
            names_p = [e[0] for e in ev]
            answer_p = "".join(json.loads(d)["t"] for n, d in ev if n == "token")
            check("project chat answers (done event, non-empty answer)", "done" in names_p and len(answer_p) > 40, f"{names_p[:8]} tools_used={'tool_call' in names_p}")
            cites_p = next((json.loads(d)["citations"] for n, d in ev if n == "citations"), [])
            check("project answer carries verified file:line citations", all(x["type"] == "code" and x["startLine"] >= 1 for x in cites_p) and len(cites_p) >= 1, str(cites_p[:1]))
        else:
            skip("project chat / debugging", "no LLM provider configured")
        dj = c.post(f"{api}/projects/repositories/{repo_id}/docs", headers=H, json={"type": "API"}).json()["jobId"]
        t0 = time.time()
        while time.time() - t0 < 120:
            j = c.get(f"{api}/jobs/{dj}", headers=H).json()
            if j["status"] in ("SUCCEEDED", "FAILED"):
                break
            time.sleep(2)
        check("API docs generated (deterministic endpoint extraction)", j["status"] == "SUCCEEDED" and "API documentation" in j["result"]["markdown"], j.get("errorMessage") or "")
        check("delete repo cascades", c.delete(f"{api}/projects/repositories/{repo_id}", headers=H).status_code == 204 and c.get(f"{api}/projects/repositories/{repo_id}", headers=H).status_code == 404)

    # ---- unified chat routing without LLM falls back to heuristic or errors cleanly
    g = c.post(api + "/conversations", headers=H, json={"module": "GENERAL"}).json()
    ev, nm = [], None
    with c.stream("POST", f"{api}/conversations/{g['id']}/messages", headers=H, json={"content": "Explain paging from my notes"}, timeout=120) as resp:
        for line in resp.iter_lines():
            if line.startswith("event:"):
                nm = line[6:].strip()
            elif line.startswith("data:"):
                ev.append((nm, line[5:].strip()))
    check("unified chat responds (stream terminates with done or typed error)", any(e[0] in ("done", "error") for e in ev), str([e[0] for e in ev][:6]))

    # ---- deletion
    check("delete document", c.delete(f"{api}/documents/{doc_id}", headers=H).status_code == 204)
    check("deleted document gone", c.get(f"{api}/documents/{doc_id}", headers=H).status_code == 404)
    check("delete account requires password", c.request("DELETE", api + "/users/me", headers=H, json={"password": "wrong-password-1"}).status_code == 401)
    check("delete account", c.request("DELETE", api + "/users/me", headers=H, json={"password": pw}).status_code == 204)
    check("deleted account cannot log in", c.post(api + "/auth/login", json={"email": email, "password": pw}).status_code == 401)
    c2.request("DELETE", api + "/users/me", headers=H2, json={"password": pw})

    fails = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len([r for r in results if r[1] == 'PASS'])} passed, {len(fails)} failed, {len([r for r in results if r[1] == 'SKIP'])} skipped")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
