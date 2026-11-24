"""Project Agent: multi-hop code investigation over one indexed repository (read-only, user-scoped tools)."""
from __future__ import annotations

import re
import uuid
from typing import AsyncIterator

from .. import db
from ..errors import AppError
from ..rag.retrieval import find_symbols, search_code
from . import prompts as P
from .base import Ctx, Event, add_text, history_messages, stream_answer
from .toolloop import Observation, Tool, observations_block, run_tools

CODE_CITE = re.compile(r"[\[【(`]([\w@./\\+-]+\.[A-Za-z]\w*):(\d+)(?:[-–](\d+))?[\]】)`]")


def parse_stack_trace_text(text: str) -> list[dict]:
    frames = []
    for m in re.finditer(r"at\s+([\w.$<>]+)\(([\w$]+\.(?:java|kt|scala)):(\d+)\)", text):  # Java
        frames.append({"function": m.group(1), "file": m.group(2), "line": int(m.group(3)), "lang": "java"})
    for m in re.finditer(r'File "([^"]+)", line (\d+)(?:, in ([\w<>]+))?', text):  # Python
        frames.append({"function": m.group(3) or "", "file": m.group(1).replace("\\", "/"), "line": int(m.group(2)), "lang": "python"})
    for m in re.finditer(r"at\s+(?:([\w.$<>]+)\s+\()?((?:[\w@./\\:-]+/)?[\w.-]+\.(?:js|jsx|ts|tsx|mjs)):(\d+):(\d+)\)?", text):  # JS/TS
        frames.append({"function": m.group(1) or "", "file": m.group(2).replace("\\", "/"), "line": int(m.group(3)), "lang": "js"})
    return frames


def build_tools(ctx: Ctx, repo_id: str) -> dict[str, Tool]:
    uid, rid = uuid.UUID(ctx.user_id), uuid.UUID(repo_id)

    async def get_repo_overview():
        r = await db.fetchrow("select full_name, branch, languages, detected_stack, summary, file_count from app.repositories where id=$1 and user_id=$2", rid, uid)
        return dict(r) if r else {"error": "repository not found"}

    async def list_directory(path: str = ""):
        prefix = path.strip("/")
        rows = await db.fetch("select path, size_bytes, is_indexed from ai.code_files where repository_id=$1 and user_id=$2 and ($3 = '' or path like $4) order by path limit 3000",
                              rid, uid, prefix, prefix + "/%")
        children: dict[str, dict] = {}
        for r in rows:
            rest = r["path"][len(prefix) + 1:] if prefix else r["path"]
            head = rest.split("/")[0]
            is_dir = "/" in rest
            c = children.setdefault(head, {"name": head, "type": "dir" if is_dir else "file", "files": 0})
            c["files"] += 1
        return {"entries": sorted(children.values(), key=lambda x: (x["type"], x["name"]))[:120]}

    async def search_code_tool(query: str, path_prefix: str | None = None, language: str | None = None, top_k: int = 6):
        hits = await search_code(ctx.user_id, repo_id, str(query), path_prefix=path_prefix, language=language, top_k=min(int(top_k), 8))
        return {"results": [{"path": h.path, "lines": f"{h.start_line}-{h.end_line}", "symbol": h.symbol, "code": h.content[:900]} for h in hits]}

    async def find_symbol(name: str):
        rows = await find_symbols(ctx.user_id, repo_id, str(name), 8)
        return {"definitions": [{"symbol": r["qualified_name"], "kind": r["kind"], "path": r["path"], "lines": f"{r['start_line']}-{r['end_line']}", "signature": r["signature"]} for r in rows]}

    async def read_file(path: str, start_line: int = 1, end_line: int | None = None):
        row = await db.fetchrow("select content, line_count from ai.code_files where repository_id=$1 and user_id=$2 and path=$3", rid, uid, str(path).lstrip("/"))
        if not row or row["content"] is None:
            return {"error": f"file not found or not readable: {path}"}
        lines = row["content"].split("\n")
        s = max(1, int(start_line))
        e = min(len(lines), int(end_line) if end_line else s + 119, s + 299)
        body = "\n".join(f"{i}: {lines[i - 1]}" for i in range(s, e + 1))
        return {"path": path, "startLine": s, "endLine": e, "totalLines": len(lines), "code": body}

    async def get_dependencies(path: str, direction: str = "out"):
        f = await db.fetchrow("select id from ai.code_files where repository_id=$1 and user_id=$2 and path=$3", rid, uid, str(path).lstrip("/"))
        if not f:
            return {"error": "file not found"}
        if direction == "in":
            rows = await db.fetch("select f.path from ai.file_dependencies d join ai.code_files f on f.id=d.from_file_id where d.repository_id=$1 and d.to_file_id=$2 limit 40", rid, f["id"])
            return {"files": [r["path"] for r in rows], "direction": "files that import this file"}
        rows = await db.fetch("""select d.import_text, d.is_external, f.path from ai.file_dependencies d left join ai.code_files f on f.id=d.to_file_id
                                 where d.repository_id=$1 and d.from_file_id=$2 limit 60""", rid, f["id"])
        return {"internal": [r["path"] for r in rows if not r["is_external"]], "external": [r["import_text"] for r in rows if r["is_external"]][:25], "direction": "imports of this file"}

    async def parse_stack_trace(text: str):
        frames = parse_stack_trace_text(str(text))
        out = []
        for fr in frames[:15]:
            base = fr["file"].rsplit("/", 1)[-1]
            rows = await db.fetch("select path from ai.code_files where repository_id=$1 and user_id=$2 and (path = $3 or path like $4) limit 3", rid, uid, fr["file"].lstrip("/"), "%/" + base)
            out.append({**fr, "repoFiles": [r["path"] for r in rows]})
        return {"frames": out}

    ts = [
        Tool("get_repo_overview", "Languages, detected stack, entry points and summary of the repository", "", get_repo_overview),
        Tool("list_directory", "List children of a directory ('' = root)", "path?: string", list_directory),
        Tool("search_code", "Hybrid semantic+keyword code search; returns path:lines, symbol and code", "query: string, path_prefix?: string, language?: string, top_k?: number", search_code_tool),
        Tool("find_symbol", "Find definitions of a class/function/method by name (e.g. 'UserService.createUser')", "name: string", find_symbol),
        Tool("read_file", "Read a file with line numbers (max 300 lines per call)", "path: string, start_line?: number, end_line?: number", read_file),
        Tool("get_dependencies", "Imports of a file (direction 'out') or files importing it (direction 'in')", "path: string, direction?: 'out'|'in'", get_dependencies),
        Tool("parse_stack_trace", "Extract frames from a pasted stack trace and map them to repository files", "text: string", parse_stack_trace),
    ]
    return {t.name: t for t in ts}


async def verify_citations(ctx: Ctx, repo_id: str) -> list[dict]:
    out, seen = [], set()
    for m in CODE_CITE.finditer(ctx.answer):
        path, s, e = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        key = (path, s, e)
        if key in seen:
            continue
        seen.add(key)
        row = await db.fetchrow("select line_count from ai.code_files where repository_id=$1 and user_id=$2 and path=$3", uuid.UUID(repo_id), uuid.UUID(ctx.user_id), path)
        if row and 1 <= s <= (row["line_count"] or 10**9):
            out.append({"id": f"C{len(out) + 1}", "type": "code", "path": path, "startLine": s, "endLine": min(e, row["line_count"] or e), "repositoryId": repo_id})
    return out[:12]


async def run(ctx: Ctx) -> AsyncIterator[Event]:
    ctx.agent = "project"
    repo_id = ctx.scope.get("repositoryId")
    if not repo_id:
        for e in add_text(ctx, "Select an indexed repository first (Projects → pick a repository), then ask your question."):
            yield e
        return
    repo = await db.fetchrow("select full_name, branch, index_status, languages, detected_stack, summary from app.repositories where id=$1 and user_id=$2", uuid.UUID(repo_id), uuid.UUID(ctx.user_id))
    if not repo:
        for e in add_text(ctx, "That repository was not found."):
            yield e
        return
    if repo["index_status"] != "READY":
        for e in add_text(ctx, f"This repository is not ready yet (status: {repo['index_status']}). Wait until indexing finishes."):
            yield e
        return
    yield Event("status", {"text": f"Investigating {repo['full_name']}…"})
    overview = (f"REPOSITORY OVERVIEW\nName: {repo['full_name']} (branch {repo['branch']})\nLanguages: {repo['languages']}\nStack: {repo['detected_stack']}\n"
                f"Summary: {(repo['summary'] or '')[:1200]}\n")
    obs: list[Observation] = []
    tools = build_tools(ctx, repo_id)
    # Deterministic seed: always ground the run in real code before the LLM decides what else to look at.
    seeds: list[tuple[str, dict]] = []
    if parse_stack_trace_text(ctx.content):
        seeds.append(("parse_stack_trace", {"text": ctx.content[:6000]}))
    seeds.append(("search_code", {"query": ctx.content[:300], "top_k": 5}))
    for name, args in seeds:
        yield Event("tool_call", {"tool": name, "args": args if name != "parse_stack_trace" else {"text": "(pasted trace)"}})
        try:
            out = await tools[name].fn(**args)
        except Exception as e:  # noqa: BLE001
            out = {"error": str(e)[:200]}
        import json as _json
        text = _json.dumps(out, ensure_ascii=False, default=str)[:3200]
        obs.append(Observation(name, args if name != "parse_stack_trace" else {"text": "(pasted trace)"}, text))
        await ctx.tracer.step(name, "TOOL", input={"seed": True, **{k: str(v)[:120] for k, v in args.items()}}, output=text[:1500])
        n = len(out.get("results", out.get("frames", []))) if isinstance(out, dict) else 0
        yield Event("tool_result", {"tool": name, "summary": f"{n} {'frames' if name == 'parse_stack_trace' else 'results'}"})
    extra = ("Strategy: for 'where/how is X implemented' use find_symbol and search_code, then read_file for the key lines. For error messages or stack traces call parse_stack_trace first, "
             "then read_file around the failing lines and follow get_dependencies if needed. For architecture questions use the overview, list_directory and get_dependencies.")
    async for e in run_tools(ctx, "Project Agent", tools, extra, obs, preamble=overview):
        yield e
    msgs = [{"role": "system", "content": P.PROJECT_FINAL_V1}] + history_messages(ctx, 4) + [
        {"role": "user", "content": f"{overview}\nTOOL RESULTS:\n{observations_block(obs)}\n\nSTUDENT MESSAGE: {ctx.content}"}]
    yield Event("status", {"text": "Writing the answer…"})
    async for e in stream_answer(ctx, msgs, tier="quality", node="project_answer", max_tokens=1800, prompt_version="project_final.v1"):
        yield e
    ctx.citations = await verify_citations(ctx, repo_id)
    ctx.grounded = bool(ctx.citations)
