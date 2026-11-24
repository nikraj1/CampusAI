"""Repository ingestion: clone -> filter -> parse -> chunk -> embed -> index (blueprint 9.3). Incremental by blob SHA."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import httpx

from .. import db
from ..config import get_settings
from ..embeddings import get_embedder
from ..errors import AppError, BadInput, NotFound
from ..llm.gateway import get_gateway
from .codeparse import language_of, parse_file, resolve_import, split_identifiers
from .jobs import progress
from .resume import private_mode_for

log = logging.getLogger("campusai.repo")
SKIP_DIRS = {"node_modules", "dist", "build", "target", "out", ".git", ".venv", "venv", "__pycache__", ".next", "coverage", "vendor",
             ".idea", ".vscode", ".gradle", "bin", "obj", ".mvn", "env", ".tox", "site-packages"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "gradlew", "gradlew.bat", "mvnw", "mvnw.cmd", "composer.lock", "Cargo.lock"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".pdf", ".zip", ".jar", ".class", ".exe", ".dll", ".so", ".woff", ".woff2",
              ".ttf", ".eot", ".mp4", ".mp3", ".bin", ".pyc", ".lock", ".map", ".gz", ".tar", ".7z", ".psd", ".db", ".sqlite"}
MAX_FILE_BYTES = 200_000
MAX_CHUNKS = 7000


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def walk_repo(root: Path, max_files: int) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git")]
        for fn in filenames:
            full = Path(dirpath) / fn
            if full.is_symlink() or fn in SKIP_FILES:
                continue
            ext = full.suffix.lower()
            if ext in BINARY_EXT or fn.endswith(".min.js"):
                continue
            rel = full.relative_to(root).as_posix()
            try:
                size = full.stat().st_size
                if size == 0:
                    continue
                data = full.read_bytes() if size <= MAX_FILE_BYTES else full.read_bytes()[:0]
            except OSError:
                continue
            if size <= MAX_FILE_BYTES and b"\0" in data[:4096]:
                continue
            out.append((rel, data if size <= MAX_FILE_BYTES else b"", ) if size <= MAX_FILE_BYTES else (rel, b""))
            # remember oversized files as non-indexed with size info through a sentinel
            if size > MAX_FILE_BYTES:
                out[-1] = (rel, b"__TOO_LARGE__:" + str(size).encode())
            if len(out) >= max_files * 2:
                break
    # prefer source over docs/config when over the cap
    def prio(item):
        rel = item[0]
        lang = language_of(rel)
        return (0 if lang in ("python", "java", "javascript", "typescript", "go", "rust", "cpp", "c", "csharp", "kotlin") else 1 if lang in ("config", "markdown") else 2, rel)
    out.sort(key=prio)
    return out[:max_files]


def detect_stack(files: dict[str, str]) -> dict:
    fw: set[str] = set(); build: set[str] = set(); dbs: set[str] = set(); entry: list[str] = []
    blob = {k.lower(): v for k, v in files.items()}

    def has(text: str, *needles: str) -> bool:
        t = text.lower()
        return any(n in t for n in needles)

    for path, text in files.items():
        name = path.rsplit("/", 1)[-1].lower()
        if name == "package.json":
            build.add("npm")
            try:
                pj = json.loads(text)
                deps = {**pj.get("dependencies", {}), **pj.get("devDependencies", {})}
            except Exception:
                deps = {}
            for d, label in (("react", "React"), ("next", "Next.js"), ("vue", "Vue"), ("@angular/core", "Angular"), ("express", "Express"), ("vite", "Vite"),
                             ("tailwindcss", "Tailwind CSS"), ("typescript", "TypeScript"), ("svelte", "Svelte"), ("nestjs", "NestJS"), ("@nestjs/core", "NestJS")):
                if d in deps:
                    fw.add(label)
            for d, label in (("mongoose", "MongoDB"), ("mongodb", "MongoDB"), ("pg", "PostgreSQL"), ("mysql2", "MySQL"), ("redis", "Redis"), ("sqlite3", "SQLite"), ("prisma", "Prisma")):
                if d in deps:
                    dbs.add(label)
            if pj.get("main") if isinstance(pj, dict) else None:
                entry.append(path.rsplit("/", 1)[0] + "/" + pj["main"] if "/" in path else pj["main"])
        elif name == "pom.xml":
            build.add("Maven")
            if has(text, "spring-boot"):
                fw.add("Spring Boot")
            for n, label in (("postgresql", "PostgreSQL"), ("mysql", "MySQL"), ("mongodb", "MongoDB"), ("h2", "H2"), ("redis", "Redis")):
                if has(text, n):
                    dbs.add(label)
        elif name in ("build.gradle", "build.gradle.kts"):
            build.add("Gradle")
            if has(text, "spring-boot", "org.springframework.boot"):
                fw.add("Spring Boot")
            if has(text, "postgresql"):
                dbs.add("PostgreSQL")
        elif name in ("requirements.txt", "pyproject.toml", "setup.py", "pipfile"):
            build.add("pip")
            for n, label in (("fastapi", "FastAPI"), ("flask", "Flask"), ("django", "Django"), ("torch", "PyTorch"), ("tensorflow", "TensorFlow"),
                             ("sqlalchemy", "SQLAlchemy"), ("streamlit", "Streamlit"), ("langchain", "LangChain")):
                if has(text, n):
                    fw.add(label)
            for n, label in (("psycopg", "PostgreSQL"), ("asyncpg", "PostgreSQL"), ("pymongo", "MongoDB"), ("redis", "Redis"), ("mysql", "MySQL")):
                if has(text, n):
                    dbs.add(label)
        elif name == "dockerfile" or name.startswith("docker-compose"):
            build.add("Docker")
            for n, label in (("postgres", "PostgreSQL"), ("mysql", "MySQL"), ("mongo", "MongoDB"), ("redis", "Redis")):
                if name.startswith("docker-compose") and has(text, "image: " + n, "image: '" + n, "/" + n):
                    dbs.add(label)
        elif name == "go.mod":
            build.add("Go modules")
        elif name == "cargo.toml":
            build.add("Cargo")
    for path, text in files.items():
        if path.endswith(".java") and "@SpringBootApplication" in text:
            entry.append(path)
        elif path.endswith(".py") and 'if __name__ == "__main__"' in text.replace("'", '"'):
            entry.append(path)
        elif path.rsplit("/", 1)[-1] in ("main.tsx", "main.jsx", "index.tsx", "server.js", "app.js", "main.ts"):
            entry.append(path)
    return {"frameworks": sorted(fw), "buildTools": sorted(build), "databases": sorted(dbs), "entryPoints": sorted(set(entry))[:10]}


async def github_precheck(owner_repo: str) -> dict:
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"https://api.github.com/repos/{owner_repo}", headers={"Accept": "application/vnd.github+json", "User-Agent": "CampusAI"})
    except httpx.HTTPError:
        return {}
    if r.status_code == 404:
        raise BadInput("Repository not found, or it is private. Only public repositories are supported in this version.", "REPO_NOT_FOUND")
    if r.status_code != 200:
        return {}  # rate limited etc: try cloning anyway
    d = r.json()
    if d.get("private"):
        raise BadInput("Private repositories are not supported in this version.", "REPO_PRIVATE")
    if int(d.get("size", 0)) > s.max_repo_kb:
        raise BadInput(f"Repository is too large ({d['size'] // 1024} MB; limit {s.max_repo_kb // 1024} MB).", "REPO_TOO_LARGE")
    return {"default_branch": d.get("default_branch"), "size": d.get("size", 0)}


def clone(url: str, branch: str | None, dest: Path) -> str:
    s = get_settings()
    cmd = [s.git_binary, "clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", "-c", "core.symlinks=false", "-c", "core.hooksPath=/dev/null"]
    if branch:
        cmd += ["--branch", branch]
    cmd += [url, str(dest)]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180, env=env)
    except subprocess.TimeoutExpired:
        raise AppError("CLONE_TIMEOUT", "Cloning the repository timed out.", retryable=True)
    if r.returncode != 0:
        err = (r.stderr or "")[-300:]
        if "not found" in err.lower() or "could not read" in err.lower() or "authentication" in err.lower():
            raise BadInput("Could not clone the repository (not found or private).", "CLONE_FAILED")
        if "remote branch" in err.lower():
            raise BadInput("The requested branch does not exist.", "BRANCH_NOT_FOUND")
        raise AppError("CLONE_FAILED", "git clone failed: " + err, retryable=True)
    h = subprocess.run([s.git_binary, "-C", str(dest), "rev-parse", "HEAD"], capture_output=True, text=True)
    return h.stdout.strip()


def current_branch(dest: Path) -> str:
    h = subprocess.run([get_settings().git_binary, "-C", str(dest), "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True)
    return h.stdout.strip()


def _readme_excerpt(files: dict[str, str]) -> str:
    for k, v in files.items():
        if k.lower() in ("readme.md", "readme.rst", "readme.txt", "readme"):
            return v[:3000]
    return ""


def _tree_summary(paths: list[str], depth: int = 2) -> str:
    seen = {}
    for p in paths:
        parts = p.split("/")
        key = "/".join(parts[:depth]) if len(parts) > depth else p
        seen[key] = seen.get(key, 0) + 1
    return "\n".join(f"{k} ({n} files)" if n > 1 else k for k, n in sorted(seen.items())[:80])


async def make_overview(full_name: str, files: dict[str, str], stack: dict, langs: dict, central: list[str], user_id: str) -> str:
    paths = list(files.keys())
    readme = _readme_excerpt(files)
    base = (f"{full_name}: " + ", ".join(f"{k} {int(v * 100)}%" for k, v in list(langs.items())[:4]) + ". "
            f"Frameworks: {', '.join(stack['frameworks']) or 'none detected'}. Build: {', '.join(stack['buildTools']) or 'n/a'}. "
            f"Databases: {', '.join(stack['databases']) or 'none detected'}. Entry points: {', '.join(stack['entryPoints'][:4]) or 'n/a'}.")
    try:
        msgs = [{"role": "system", "content": "You write concise technical overviews of software repositories for students. 120-200 words, markdown, no fluff. "
                 "Use only the supplied facts."},
                {"role": "user", "content": f"FACTS:\n{base}\n\nMOST-IMPORTED FILES: {', '.join(central[:8])}\n\nDIRECTORY TREE:\n{_tree_summary(paths)}\n\nREADME EXCERPT:\n{readme}\n\nWrite the overview."}]
        res = await get_gateway().complete(msgs, "quality", max_tokens=500, private_mode=await private_mode_for(user_id))
        return res.text.strip()
    except AppError:
        return base + ("\n\n" + readme[:600] if readme else "")


async def index_repository(job: dict) -> dict:
    s = get_settings()
    user_id = str(job["user_id"])
    uid = uuid.UUID(user_id)
    repo_id = uuid.UUID(job["payload"]["repositoryId"])
    repo = await db.fetchrow("select * from app.repositories where id=$1 and user_id=$2", repo_id, uid)
    if not repo:
        raise NotFound("Repository")
    jid = job["id"]
    await db.execute("update app.repositories set index_status='INDEXING', error_message=null, updated_at=now() where id=$1", repo_id)
    tmp = Path(s.repo_tmp_dir) / str(job["id"])
    try:
        await progress(jid, "CHECKING", 3)
        meta = await github_precheck(repo["full_name"])
        branch = repo["branch"] or meta.get("default_branch") or None
        await progress(jid, "CLONING", 8)
        tmp.parent.mkdir(parents=True, exist_ok=True)
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        commit = await asyncio.to_thread(clone, f"https://github.com/{repo['full_name']}.git", branch if repo["branch"] else None, tmp)
        real_branch = await asyncio.to_thread(current_branch, tmp)
        await progress(jid, "SCANNING", 20)
        entries = await asyncio.to_thread(walk_repo, tmp, s.max_repo_files)
        if not entries:
            raise BadInput("No indexable source files were found in this repository.", "EMPTY_REPO")

        existing = {r["path"]: r for r in await db.fetch("select id, path, blob_sha from ai.code_files where repository_id=$1 and user_id=$2", repo_id, uid)}
        texts: dict[str, str] = {}
        shas: dict[str, str] = {}
        oversized: dict[str, int] = {}
        for rel, data in entries:
            if data.startswith(b"__TOO_LARGE__:"):
                oversized[rel] = int(data.split(b":")[1])
                continue
            try:
                texts[rel] = data.decode("utf-8")
            except UnicodeDecodeError:
                texts[rel] = data.decode("latin-1", errors="replace")
            shas[rel] = git_blob_sha(data)
        lang_bytes: dict[str, int] = {}
        for rel, t in texts.items():
            lg = language_of(rel)
            if lg and lg not in ("markdown", "json", "yaml", "xml", "text", "properties", "config", "toml"):
                lang_bytes[lg] = lang_bytes.get(lg, 0) + len(t)
        total = sum(lang_bytes.values()) or 1
        languages = {k: round(v / total, 3) for k, v in sorted(lang_bytes.items(), key=lambda x: -x[1])}

        changed = [p for p in texts if p not in existing or existing[p]["blob_sha"] != shas[p]]
        removed = [p for p in existing if p not in texts and p not in oversized]
        await progress(jid, "PARSING", 30)
        all_paths = set(texts.keys())
        by_suffix: dict[str, str] = {}
        for p in all_paths:
            parts = p.split("/")
            for i in range(len(parts)):
                by_suffix.setdefault("/".join(parts[i:]), p)

        parsed_by_path = {}
        n_chunks_total = 0
        for rel in changed:
            lang = language_of(rel)
            if not lang:
                parsed_by_path[rel] = (None, None)
                continue
            parsed = await asyncio.to_thread(parse_file, rel, lang, texts[rel])
            parsed_by_path[rel] = (lang, parsed)
            n_chunks_total += len(parsed.chunks)
        if n_chunks_total > MAX_CHUNKS:
            # keep source files first (already sorted by priority); truncate the tail
            budget = MAX_CHUNKS
            for rel in changed:
                lang, parsed = parsed_by_path[rel]
                if parsed is None:
                    continue
                if budget <= 0:
                    parsed.chunks = []
                else:
                    parsed.chunks = parsed.chunks[:budget]
                    budget -= len(parsed.chunks)

        await progress(jid, "EMBEDDING", 40)
        emb = get_embedder()
        flat: list[tuple[str, object]] = []
        for rel in changed:
            lang, parsed = parsed_by_path[rel]
            if parsed is None:
                continue
            for ch in parsed.chunks:
                flat.append((rel, ch))
        header_texts = []
        for rel, ch in flat:
            lang = language_of(rel)
            header_texts.append(f"File: {rel} | Lang: {lang} | Symbol: {ch.symbol or '-'}\n{ch.text[:1800]}")
        vectors = []
        B = 48
        for i in range(0, len(header_texts), B):
            vectors.extend(await emb.embed_passages(header_texts[i:i + B]))
            await progress(jid, "EMBEDDING", 40 + int(45 * min(1.0, (i + B) / max(1, len(header_texts)))))

        await progress(jid, "WRITING", 90)
        file_ids: dict[str, uuid.UUID] = {}
        async with db.tx(user_id) as c:
            for p in removed:
                await c.execute("delete from ai.code_files where id=$1", existing[p]["id"])
            for rel in changed:
                if rel in existing:
                    await c.execute("delete from ai.code_files where id=$1", existing[rel]["id"])  # cascades chunks/symbols/deps
            for rel in changed:
                lang = language_of(rel)
                fid = uuid.uuid4()
                file_ids[rel] = fid
                await c.execute(
                    "insert into ai.code_files(id, user_id, repository_id, path, language, blob_sha, size_bytes, line_count, content, is_indexed) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                    fid, uid, repo_id, rel, lang, shas[rel], len(texts[rel].encode("utf-8", "ignore")), texts[rel].count("\n") + 1, texts[rel], lang is not None)
            for rel, size in oversized.items():
                if rel not in existing:
                    await c.execute("insert into ai.code_files(user_id, repository_id, path, language, blob_sha, size_bytes, content, is_indexed) values ($1,$2,$3,$4,$5,$6,null,false) on conflict do nothing",
                                    uid, repo_id, rel, language_of(rel), "0" * 40, size)
            rows = []
            for (rel, ch), vec in zip(flat, vectors):
                lang = language_of(rel)
                search = f"{rel} {ch.symbol or ''}\n" + split_identifiers(ch.text[:3000])
                rows.append((uuid.uuid4(), uid, repo_id, file_ids[rel], rel, lang, (ch.symbol or None), ch.kind, ch.start, ch.end, ch.text[:6000], search[:9000], vec))
            if rows:
                await c.executemany(
                    "insert into ai.code_chunks(id, user_id, repository_id, file_id, path, language, symbol_name, symbol_kind, start_line, end_line, content, search_text, embedding) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", rows)
            sym_rows = []
            for rel in changed:
                lang, parsed = parsed_by_path[rel]
                if parsed:
                    for sy in parsed.symbols:
                        sym_rows.append((uuid.uuid4(), uid, repo_id, file_ids[rel], sy.name[:300], sy.qualified[:600], sy.kind, sy.signature[:1000], sy.start, sy.end))
            if sym_rows:
                await c.executemany("insert into ai.code_symbols(id, user_id, repository_id, file_id, name, qualified_name, kind, signature, start_line, end_line) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", sym_rows)
            # dependencies: rebuilt for the whole repository (cheap) so that edges to changed files stay valid
            await c.execute("delete from ai.file_dependencies where repository_id=$1", repo_id)
            id_by_path = {r["path"]: r["id"] for r in await c.fetch("select id, path from ai.code_files where repository_id=$1", repo_id)}
            dep_rows = []
            in_degree: dict[str, int] = {}
            for rel, text in texts.items():
                lang = language_of(rel)
                if lang not in ("python", "java", "javascript", "typescript") or rel not in id_by_path:
                    continue
                parsed = parsed_by_path.get(rel, (None, None))[1] or await asyncio.to_thread(parse_file, rel, lang, text)
                seen = set()
                for imp in parsed.imports:
                    if imp in seen:
                        continue
                    seen.add(imp)
                    target = resolve_import(imp, rel, lang, all_paths, by_suffix)
                    if target and target != rel and target in id_by_path:
                        in_degree[target] = in_degree.get(target, 0) + 1
                        dep_rows.append((uid, repo_id, id_by_path[rel], id_by_path[target], imp[:500], False))
                    else:
                        dep_rows.append((uid, repo_id, id_by_path[rel], None, imp[:500], True))
            if dep_rows:
                await c.executemany("insert into ai.file_dependencies(user_id, repository_id, from_file_id, to_file_id, import_text, is_external) values ($1,$2,$3,$4,$5,$6)", dep_rows)
            n_chunks = await c.fetchval("select count(*) from ai.code_chunks where repository_id=$1", repo_id)
            n_files = await c.fetchval("select count(*) from ai.code_files where repository_id=$1", repo_id)

        stack = detect_stack({k: v for k, v in texts.items() if language_of(k) in ("config", "java", "python", "javascript", "typescript", "markdown", "yaml") or k.lower().endswith(("package.json", "pom.xml"))})
        central = [p for p, _ in sorted(in_degree.items(), key=lambda x: -x[1])[:10]]
        summary = await make_overview(repo["full_name"], texts, stack, languages, central, user_id)
        await db.execute(
            """update app.repositories set index_status='READY', last_indexed_commit=$2, indexed_at=now(), file_count=$3, chunk_count=$4, languages=$5,
               detected_stack=$6, summary=$7, branch=$8, error_message=null, updated_at=now() where id=$1""",
            repo_id, commit[:40] or None, n_files, n_chunks, languages, {**stack, "centralFiles": central}, summary, real_branch or branch or "")
        return {"repositoryId": str(repo_id), "files": n_files, "chunks": n_chunks, "changedFiles": len(changed), "removedFiles": len(removed)}
    except Exception as e:
        msg = getattr(e, "message", None) or str(e)
        await db.execute("update app.repositories set index_status='FAILED', error_message=$2, updated_at=now() where id=$1", repo_id, msg[:480])
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
