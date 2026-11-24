"""Repository documentation generation (README / API / ARCHITECTURE) from indexed data. Endpoints and dependency graph are extracted deterministically."""
from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict

from .. import db
from ..errors import AppError, BadInput, NotFound
from ..ingestion.resume import private_mode_for
from ..llm.gateway import get_gateway

SPRING_CLASS = re.compile(r"@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?\"([^\"]*)\"")
SPRING_METHOD = re.compile(r"@(Get|Post|Put|Delete|Patch)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?\"([^\"]*)\")?")
PY_ROUTE = re.compile(r"@(?:\w+)\.(get|post|put|delete|patch)\(\s*[\"']([^\"']*)[\"']")
JS_ROUTE = re.compile(r"\b(?:app|router|server)\.(get|post|put|delete|patch)\(\s*[\"'`]([^\"'`]*)[\"'`]")


def extract_endpoints(path: str, text: str) -> list[dict]:
    out = []
    lines = text.split("\n")
    if path.endswith(".java"):
        base = ""
        m = SPRING_CLASS.search(text)
        if m:
            base = m.group(1)
        for i, ln in enumerate(lines, 1):
            m2 = SPRING_METHOD.search(ln)
            if m2:
                sub = m2.group(2) or ""
                handler = ""
                for nxt in lines[i:i + 6]:
                    h = re.search(r"\b(\w+)\s*\(", nxt)
                    if h and not nxt.strip().startswith("@"):
                        handler = h.group(1)
                        break
                out.append({"method": m2.group(1).upper(), "path": ("/" + (base + "/" + sub).strip("/")).replace("//", "/"), "file": path, "line": i, "handler": handler})
    elif path.endswith(".py"):
        for i, ln in enumerate(lines, 1):
            m = PY_ROUTE.search(ln)
            if m:
                handler = next((re.search(r"def\s+(\w+)", x).group(1) for x in lines[i:i + 4] if re.search(r"def\s+(\w+)", x)), "")
                out.append({"method": m.group(1).upper(), "path": m.group(2), "file": path, "line": i, "handler": handler})
    elif path.endswith((".js", ".ts", ".mjs", ".jsx", ".tsx")):
        for i, ln in enumerate(lines, 1):
            m = JS_ROUTE.search(ln)
            if m:
                out.append({"method": m.group(1).upper(), "path": m.group(2), "file": path, "line": i, "handler": ""})
    return out


async def generate_docs(user_id: str, repository_id: str, dtype: str) -> dict:
    uid, rid = uuid.UUID(user_id), uuid.UUID(repository_id)
    repo = await db.fetchrow("select full_name, branch, languages, detected_stack, summary, index_status from app.repositories where id=$1 and user_id=$2", rid, uid)
    if not repo:
        raise NotFound("Repository")
    if repo["index_status"] != "READY":
        raise BadInput("Repository is not indexed yet.")
    files = await db.fetch("select path, language, content, line_count from ai.code_files where repository_id=$1 and user_id=$2 order by path", rid, uid)
    priv = await private_mode_for(user_id)
    stack = repo["detected_stack"] or {}
    readme = next((f["content"] for f in files if f["path"].lower() == "readme.md" and f["content"]), "")
    tree = "\n".join(sorted({"/".join(f["path"].split("/")[:2]) for f in files}))[:2500]

    if dtype == "API":
        eps = []
        for f in files:
            if f["content"] and f["language"] in ("java", "python", "javascript", "typescript"):
                eps += extract_endpoints(f["path"], f["content"])
        if not eps:
            return {"markdown": f"# API documentation: {repo['full_name']}\n\nNo HTTP endpoints were detected (supported: Spring MVC, FastAPI/Flask-style decorators, Express-style routes)."}
        desc: dict[int, str] = {}
        try:
            snippets = []
            for i, e in enumerate(eps[:30]):
                f = next(x for x in files if x["path"] == e["file"])
                ls = f["content"].split("\n")[max(0, e["line"] - 1): e["line"] + 14]
                snippets.append({"i": i, "method": e["method"], "path": e["path"], "code": "\n".join(ls)[:700]})
            import json
            from ..llm.gateway import extract_json
            res = await get_gateway().complete([{"role": "system", "content": 'For each endpoint write a one-sentence description of what it does, inferred ONLY from the code. Reply ONLY with JSON {"items":[{"i":0,"description":"..."}]}.'},
                                                {"role": "user", "content": json.dumps(snippets, ensure_ascii=False)}], "structured", max_tokens=2500, json_mode=True, private_mode=priv)
            desc = {int(x["i"]): x["description"] for x in extract_json(res.text).get("items", [])}
        except (AppError, ValueError, KeyError, TypeError):
            pass
        rows = "\n".join(f"| `{e['method']}` | `{e['path']}` | {desc.get(i, '')} | `{e['file']}:{e['line']}` |" for i, e in enumerate(eps))
        return {"markdown": f"# API documentation: {repo['full_name']}\n\n{len(eps)} endpoints detected.\n\n| Method | Path | Description | Source |\n|---|---|---|---|\n{rows}\n"}

    if dtype == "ARCHITECTURE":
        deps = await db.fetch("""select f1.path as src, f2.path as dst from ai.file_dependencies d join ai.code_files f1 on f1.id=d.from_file_id join ai.code_files f2 on f2.id=d.to_file_id
                                 where d.repository_id=$1 and d.user_id=$2 and not d.is_external""", rid, uid)

        def mod(p: str) -> str:
            parts = p.split("/")
            if parts[0] in ("src", "app", "lib") and len(parts) > 2:
                return "/".join(parts[:2])
            if "java" in parts:  # maven layout: collapse to package root + 1
                i = parts.index("java")
                return "/".join(parts[i + 1:i + 4]) if len(parts) > i + 4 else "/".join(parts[:2])
            return parts[0] if len(parts) > 1 else "(root)"
        edges = Counter((mod(d["src"]), mod(d["dst"])) for d in deps if mod(d["src"]) != mod(d["dst"]))
        top = edges.most_common(25)
        ids: dict[str, str] = {}
        def nid(m: str) -> str:
            return ids.setdefault(m, f"n{len(ids)}")
        mer = ["flowchart LR"] + [f'  {nid(a)}["{a}"] -->|{c}| {nid(b)}["{b}"]' for (a, b), c in top]
        indeg = Counter(d["dst"] for d in deps)
        central = [p for p, _ in indeg.most_common(8)]
        narrative = ""
        try:
            res = await get_gateway().complete([{"role": "system", "content": "Write an ARCHITECTURE.md body (markdown, 250-400 words): components, responsibilities, data flow, key files. Use only the given facts; do not invent components."},
                                                {"role": "user", "content": f"Repo {repo['full_name']}\nStack: {stack}\nSummary: {repo['summary']}\nTop-level tree:\n{tree}\nMost depended-on files: {central}\nModule dependency edges: {[(a, b, c) for (a, b), c in top[:15]]}"}],
                                               "quality", max_tokens=1000, private_mode=priv)
            narrative = res.text.strip()
        except AppError:
            narrative = f"**Stack:** {stack}\n\n{repo['summary'] or ''}"
        return {"markdown": f"# Architecture: {repo['full_name']}\n\n{narrative}\n\n## Module dependency graph\n\n```mermaid\n" + "\n".join(mer) + "\n```\n\n## Most depended-on files\n" + "\n".join(f"- `{p}`" for p in central) + "\n"}

    # README
    entry = stack.get("entryPoints") or []
    facts = f"Name: {repo['full_name']}\nLanguages: {repo['languages']}\nStack: {stack}\nEntry points: {entry}\nTree:\n{tree}\nExisting README excerpt:\n{readme[:2500]}\nOverview: {repo['summary']}"
    try:
        res = await get_gateway().complete([{"role": "system", "content": "Write a professional README.md for this repository: title, one-paragraph description, features (only what is evident), tech stack, project structure, getting started "
                                             "(only commands evident from the stack e.g. mvn/npm/pip; mark guesses with 'check'), and usage. Do not invent features or URLs."},
                                            {"role": "user", "content": facts}], "quality", max_tokens=1600, private_mode=priv)
        return {"markdown": res.text.strip()}
    except AppError:
        langs = ", ".join(f"{k} ({int(v * 100)}%)" for k, v in list((repo["languages"] or {}).items())[:4])
        return {"markdown": f"# {repo['full_name'].split('/')[-1]}\n\n{repo['summary'] or ''}\n\n## Tech stack\n- Languages: {langs}\n- Frameworks: {', '.join(stack.get('frameworks', [])) or 'n/a'}\n- Build tools: {', '.join(stack.get('buildTools', [])) or 'n/a'}\n\n## Project structure\n```\n{tree}\n```\n"}
