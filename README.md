# CampusAI

**An agentic AI-powered student copilot for personalised learning, career development and project assistance.**

Three modules behind one agent orchestrator:

| Module | What it does |
|---|---|
| **Study AI** | Upload PDF/DOCX notes → extraction, structure-aware chunking, local embeddings, hybrid (dense + full-text, RRF) retrieval. Cited answers with page numbers, corrective RAG (grade → rewrite → retry → abstain), citation support check, topic/document summaries, validated + verified + de-duplicated MCQ quizzes, adaptive difficulty, topic mastery tracking. |
| **Career AI** | Resume parsing (layout-aware, PII masked), explainable rule-based scoring, JD parsing and resume↔JD matching, skill gaps linked to *your own notes* + curated free resources, roadmaps with progress, interview question bank, adaptive mock interviews with rubric scoring and report, Career agent chat. |
| **Project AI** | Index a public GitHub repo (shallow clone, language-aware chunking, symbols, import graph, stack detection), code-aware hybrid retrieval, tool-using Project agent (`find_symbol`, `search_code`, `read_file`, `get_dependencies`, `parse_stack_trace`) with verified `file:line` citations, README/API/ARCHITECTURE doc generation. |
| **Orchestrator** | Unified chat: intent classifier (LLM + heuristic fallback) → single agent or a bounded, validated multi-step plan (≤3 steps) → synthesis. Every run is traced (`agent_runs`/`agent_steps`) and viewable in the UI. |

Design source of truth: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md). Deviations from it are listed in [Implementation notes](#implementation-notes).

## Architecture

```
Browser (React/TS/Tailwind)  ──►  Spring Boot API (:8080)  ──service JWT──►  FastAPI AI service (:8000)
                                      │  auth, domain, files, jobs, SSE proxy        │  LLM gateway, RAG, agents, ingestion worker
                                      └──────────────►  PostgreSQL 16/17 + pgvector  ◄┘
```

* `apps/web` – React 18 + TypeScript + Vite + Tailwind (route-split bundle, Light/Dark/System theme, copyable Markdown code blocks, live SSE chat & Agent Trace)
* `services/api` – Java 21, Spring Boot 3.3, Spring Security (JWT access token + rotating HttpOnly refresh cookie), Flyway (owns **all** DDL), JDBC
* `services/ai` – Python 3.11+, FastAPI, asyncpg + pgvector, fastembed (`BAAI/bge-small-en-v1.5`, local), provider-agnostic LLM gateway
* Background work: Postgres job queue (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` + periodic stuck-job reaper); ingestion jobs run in the Python worker, generation jobs on a virtual-thread executor in Spring.

## Quick start (development)

### Prerequisites
Java 21, Maven 3.9+, Node 20+, Python 3.11+, Git, and PostgreSQL 16+ **with the pgvector extension**.

> **Windows one-command start (WSL PostgreSQL):** once `.env`, `services/ai/.venv`, and `apps/web/node_modules` are set up, launch the entire stack with:
> ```powershell
> powershell -NoProfile -File scripts/start-dev.ps1
> ```

1. **Database** (pick one)
   * Docker: `docker compose -f infra/docker-compose.yml --env-file .env up -d db`
   * No Docker (Windows/WSL Ubuntu): `wsl -d Ubuntu -u root -- bash infra/scripts/wsl-postgres.sh` after `apt install postgresql postgresql-16-pgvector`
   * Any Postgres: `CREATE ROLE campusai LOGIN PASSWORD 'campusai'; CREATE DATABASE campusai OWNER campusai;` (the migration creates the extensions; the role needs to be allowed to `CREATE EXTENSION vector` or be superuser)
2. **LLM provider** – copy `.env.example` to `.env` and set **at least one** key (all have free tiers): `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, or `OPENAI_API_KEY`; or run Ollama (`OLLAMA_BASE_URL`). Models/fallback order: [`services/ai/campusai_ai/llm/llm.yaml`](services/ai/campusai_ai/llm/llm.yaml). The shipped config targets Groq's `openai/gpt-oss-120b` / `openai/gpt-oss-20b` (tested); list the models your key can use with `python scripts/list_groq_models.py` and override with `LLM_FAST`, `LLM_QUALITY`, `LLM_STRUCTURED`, e.g. `LLM_QUALITY=groq/openai/gpt-oss-120b,gemini/gemini-2.0-flash`. Provider keys in `.env` are loaded automatically by the AI service; the Spring API needs the same secrets, so start it with `scripts/start-api.ps1` (Windows) which exports `.env` first.
3. **Spring API**
   ```bash
   cd services/api
   mvn -DskipTests package
   java -jar target/campusai-api-1.0.0.jar        # Flyway migrates on startup
   ```
4. **AI service** (also runs the ingestion worker in-process by default)
   ```bash
   cd services/ai
   python -m venv .venv && .venv/bin/pip install -e ".[dev]"     # Windows: .venv\Scripts\pip
   # export the keys from .env, or put them in services/ai/.env
   .venv/bin/python -m uvicorn campusai_ai.api.main:app --port 8000
   ```
   The first start downloads the embedding model (~130 MB) to `services/ai/.cache`.
5. **Frontend**
   ```bash
   cd apps/web && npm install && npm run dev      # http://localhost:5173 (proxies /api to :8080)
   ```

Environment variables read by Spring: `DB_URL`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `AI_SERVICE_JWT_SECRET` (**must match** the AI service's value), `AI_SERVICE_URL`, `FILE_STORAGE_DIR`, `COOKIE_SECURE`, `CORS_ORIGINS`.
Both JWT secrets must be ≥ 32 bytes; defaults exist **for local dev only**.

### Full stack with Docker Compose
```bash
cp .env.example .env     # set JWT_SECRET, AI_SERVICE_JWT_SECRET (>=32 chars, random) and an LLM key
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```
Frontend on `http://localhost`. See `infra/` (Caddyfile for HTTPS, `scripts/`).

## Tests

```bash
cd services/api && mvn test                          # scoring/mastery, JWT, URL parsing
cd services/ai  && .venv/bin/python -m pytest        # chunking, RRF, gateway fallback/cooldown/repair/stream, quiz validation, skills, code parsing, service-JWT security
cd apps/web     && npx tsc --noEmit && npm run build # type-check + production build
python scripts/e2e_smoke.py [--repo URL]             # live end-to-end run against the running stack (needs services up)
```
`scripts/e2e_smoke.py` registers two throw-away users and exercises auth (rotation + reuse detection), upload validation, ingestion, cross-user isolation, resume/JD/analysis/roadmap, repository indexing and – when an LLM is configured – chat, citations, abstention, quizzes, mock interviews and project chat. LLM-dependent checks are reported as `SKIP` if no provider is configured.

## Security highlights
* BCrypt(12), lockout after 5 failures, refresh-token rotation with reuse detection (family revocation), access token kept in memory only.
* Magic-byte upload validation, size/quota limits, server-generated storage names.
* AI service trusts **only** the signed service JWT for identity (`aud`/`iss` checked); every retrieval query carries `user_id`; Spring validates every scope ID belongs to the caller; foreign resources return 404.
* Retrieved text is wrapped as untrusted data; agent tools are read-only and user-scoped; markdown output is sanitised.
* Optional **private mode** restricts routing to local/no-training providers.
* Logs contain IDs, not document/resume content.

## Implementation notes
Pragmatic deviations from the blueprint (kept small to ship a complete, tested system):

| Blueprint | Implemented |
|---|---|
| Spring Data JPA | Spring `JdbcClient` + a thin `Db` helper (fewer moving parts) |
| LangGraph | Explicit async-generator state machines (`agents/`) with the same graph shape; no extra dependency |
| tree-sitter | `ast` for Python; brace-matching parsers for Java/JS/TS; line windows for other languages |
| RLS + 3 DB roles | Single DB role; isolation via mandatory `user_id` predicates + Spring scope validation (RLS is a documented follow-up) |
| Cross-encoder reranker | Not enabled (blueprint: only if ablation justifies it); RRF + neighbour stitching used |
| GitHub OAuth / private repos | Not implemented: public repositories only |
| OCR | Used automatically when Tesseract is installed (included in the Docker image); otherwise scanned pages are reported as unreadable |
| PDF Range requests, `skills` table, interview `report` plan column | Simplified (full-file download; taxonomy in code; plan stored as pre-created questions) |
| Mermaid rendering in generated docs | Shown as a code block (copy into any Mermaid renderer) |

## Repository layout
```
apps/web            React SPA
services/api        Spring Boot (Flyway migrations in src/main/resources/db/migration)
services/ai         FastAPI AI service + ingestion worker + tests
infrastructure      docker-compose, Caddy, helper scripts
scripts             end-to-end smoke test
docs                BLUEPRINT.md (architecture & plan)
```
