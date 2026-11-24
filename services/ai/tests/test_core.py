"""Unit tests for pure logic: chunking, RRF, JSON extraction, gateway fallback, quiz validation, skills, code parsing."""
import json

import httpx
import pytest
import respx

from campusai_ai.agents.project import parse_stack_trace_text
from campusai_ai.errors import LLMError, NotConfigured
from campusai_ai.ingestion import chunking as ck
from campusai_ai.ingestion.codeparse import parse_file, resolve_import, split_identifiers
from campusai_ai.llm.gateway import LLMGateway, extract_json
from campusai_ai.rag.retrieval import code_identifiers, keywords, rrf, Hit, stitch
from campusai_ai.skills import extract_skills, normalize
from campusai_ai.workflows.career import METRIC, deterministic_jd, overall, section_scores, resume_checks
from campusai_ai.workflows.study import QQ, allocate, difficulty_for, validate_question


# ---------- chunking ----------
def make_pages():
    long = " ".join(f"Sentence number {i} explains paging in operating systems clearly." for i in range(120))
    return [(1, "# Memory Management\n\n## Paging\n\n" + long), (2, long + "\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"), (3, "## Segmentation\n\nSegmentation divides memory into logical segments.")]


def test_chunks_have_pages_sections_and_size_limits():
    chunks = ck.chunk_blocks(ck.to_blocks(make_pages()))
    assert len(chunks) >= 3
    assert all(c.tokens <= ck.MAX_TOKENS + 80 for c in chunks)
    assert chunks[0].page_start == 1
    assert any(c.page_end == 3 for c in chunks)
    assert any("Paging" in c.section_path for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_table_not_split_mid_row():
    chunks = ck.chunk_blocks(ck.to_blocks(make_pages()))
    joined = "\n".join(c.text for c in chunks)
    assert "| a | b |" in joined and "| 3 | 4 |" in joined


def test_repeated_headers_and_page_numbers_removed():
    pages = [(i, f"ACME University Notes\nContent of page {i} with real text here.\n{i}") for i in range(1, 8)]
    out = ck.strip_repeated_lines(pages)
    assert all("ACME University Notes" not in t for _, t in out)


def test_embedding_text_has_context_header_but_stored_text_clean():
    c = ck.Chunk(0, "body text", "Unit 3 › Paging", 4, 4, 5)
    assert ck.embedding_text("OS Notes", c).startswith("OS Notes › Unit 3 › Paging")
    assert c.text == "body text"


# ---------- retrieval helpers ----------
def test_rrf_prefers_docs_found_by_both_lists():
    s = rrf([["a", "b", "c"], ["b", "d", "a"]])
    assert s["b"] > s["c"] and s["a"] > s["d"]
    assert max(s, key=s.get) in ("a", "b")


def test_keywords_drop_stopwords():
    assert "paging" in keywords("What is the difference between paging and segmentation?")
    assert "what" not in keywords("What is paging")


def test_stitch_merges_adjacent_chunks():
    mk = lambda i: Hit(f"id{i}", "d1", "T", i, i, "", f"text{i}", None, i, dense=0.5, fused=0.1)
    out = stitch([mk(3), mk(4), mk(9)])
    assert len(out) == 2
    assert any("text3" in h.content and "text4" in h.content for h in out)


def test_code_identifier_detection():
    assert "UserService.createUser" in code_identifiers("where is UserService.createUser used?")
    assert "get_user_by_id" in code_identifiers("explain get_user_by_id")
    assert code_identifiers("how does login work") == []


# ---------- json + gateway ----------
def test_extract_json_handles_fences_and_noise():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here you go: {"a": {"b": [1,2]}} hope it helps') == {"a": {"b": [1, 2]}}
    with pytest.raises(ValueError):
        extract_json("no json here")


def _gw(monkeypatch, keys):
    for k in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in keys.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("LLM_QUALITY", "groq/m1,gemini/m2")
    monkeypatch.setenv("LLM_FAST", "groq/m1,gemini/m2")
    monkeypatch.setenv("LLM_STRUCTURED", "groq/m1,gemini/m2")
    return LLMGateway()


def ok_body(text="hello"):
    return {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 5, "completion_tokens": 2}}


async def test_gateway_falls_back_on_429_and_cools_down(monkeypatch):
    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x", "GEMINI_API_KEY": "y"})
    with respx.mock:
        groq = respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=httpx.Response(429, headers={"retry-after": "30"}))
        gem = respx.post("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions").mock(return_value=httpx.Response(200, json=ok_body("from gemini")))
        r = await gw.complete([{"role": "user", "content": "hi"}], "quality")
        assert r.text == "from gemini" and r.model.startswith("gemini/")
        r2 = await gw.complete([{"role": "user", "content": "again"}], "quality")  # groq now cooling down -> not called again
        assert groq.call_count == 1 and gem.call_count == 2


async def test_gateway_retries_5xx_then_falls_back(monkeypatch):
    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x", "GEMINI_API_KEY": "y"})
    with respx.mock:
        respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=httpx.Response(503))
        respx.post("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions").mock(return_value=httpx.Response(200, json=ok_body("g")))
        assert (await gw.complete([{"role": "user", "content": "hi"}], "fast")).text == "g"


async def test_gateway_no_provider_raises_not_configured(monkeypatch):
    gw = _gw(monkeypatch, {})
    gw._ollama_ok = (10**12, False)
    with pytest.raises(NotConfigured):
        await gw.complete([{"role": "user", "content": "hi"}], "quality")


async def test_gateway_all_fail_is_retryable_error(monkeypatch):
    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x"})
    with respx.mock:
        respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=httpx.Response(500))
        with pytest.raises(LLMError) as e:
            await gw.complete([{"role": "user", "content": "hi"}], "quality")
        assert e.value.retryable


async def test_gateway_private_mode_refuses_free_tier(monkeypatch):
    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x"})
    gw._ollama_ok = (10**12, False)
    with pytest.raises(LLMError) as e:
        await gw.complete([{"role": "user", "content": "hi"}], "quality", private_mode=True)
    assert e.value.code == "PRIVATE_MODE_NO_PROVIDER"


async def test_structured_output_repairs_once(monkeypatch):
    from pydantic import BaseModel

    class M(BaseModel):
        x: int

    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x"})
    with respx.mock:
        route = respx.post("https://api.groq.com/openai/v1/chat/completions").mock(side_effect=[httpx.Response(200, json=ok_body("not json")), httpx.Response(200, json=ok_body('{"x": 7}'))])
        out, _ = await gw.complete_model([{"role": "user", "content": "give x"}], M, "structured")
        assert out.x == 7 and route.call_count == 2


async def test_streaming_yields_tokens_and_done(monkeypatch):
    gw = _gw(monkeypatch, {"GROQ_API_KEY": "x"})
    sse = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': t}}]})}\n\n" for t in ("Hel", "lo")) + "data: [DONE]\n\n"
    with respx.mock:
        respx.post("https://api.groq.com/openai/v1/chat/completions").mock(return_value=httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"}))
        chunks = [c async for c in gw.stream([{"role": "user", "content": "hi"}], "quality")]
    assert "".join(c.text for c in chunks) == "Hello" and chunks[-1].done


# ---------- quiz validation ----------
def test_quiz_validation_rules():
    good = QQ(stem="What is paging?", options=["A", "B", "C", "D"], correctIndices=[1], explanation="because")
    assert validate_question(good) is None
    assert validate_question(QQ(stem="x", options=["A", "A", "C", "D"], correctIndices=[0], explanation="e")) == "duplicate/empty options"
    assert validate_question(QQ(stem="x", options=["A", "B", "C", "All of the above"], correctIndices=[0], explanation="e")) == "banned option"
    assert validate_question(QQ(stem="x", options=["A", "B", "C", "D"], correctIndices=[7], explanation="e")) == "bad correct index"
    assert validate_question(QQ(stem="x", options=["A", "B", "C", "D"], correctIndices=[0, 1], explanation="e")) == "single answer required"
    assert validate_question(QQ(stem="x", options=["A", "B", "C"], correctIndices=[0], explanation="e")) == "need 4 options"
    tf = QQ(type="TRUE_FALSE", stem="Paging is a memory scheme", options=[], correctIndices=[0], explanation="yes")
    assert validate_question(tf) is None and tf.options == ["True", "False"]


def test_allocation_and_adaptive_difficulty():
    assert sum(allocate(10, [0.5, 0.3, 0.2])) == 10
    a = allocate(10, [1.3, 0.3])
    assert a[0] > a[1]
    assert difficulty_for("ADAPTIVE", 0.2) == "EASY" and difficulty_for("ADAPTIVE", 0.5) == "MEDIUM" and difficulty_for("ADAPTIVE", 0.9) == "HARD"
    assert difficulty_for("HARD", 0.1) == "HARD"


# ---------- skills / career ----------
def test_skill_extraction_and_normalization():
    names = {s.name for s in extract_skills("Built REST APIs with Spring Boot, PostgreSQL and Docker. Used C++ and React.js; Node.js backend, CI/CD via GitHub Actions")}
    assert {"Spring Boot", "PostgreSQL", "Docker", "C++", "React", "Node.js", "REST APIs", "CI/CD"} <= names
    assert "Java" not in {s.name for s in extract_skills("I love javascript")}
    assert normalize("springboot").name == "Spring Boot" and normalize("k8s").name == "Kubernetes" and normalize("zzzz") is None


def test_jd_split_required_vs_preferred():
    jd = "Backend Intern\nRequirements:\n- Java and Spring Boot\n- SQL\nNice to have:\n- Docker\n- Kubernetes\n5+ years not needed. 1 year experience"
    p = deterministic_jd(jd)
    assert {s["name"] for s in p["requiredSkills"]} >= {"Java", "Spring Boot", "SQL"}
    assert {s["name"] for s in p["preferredSkills"]} >= {"Docker", "Kubernetes"}


def test_resume_scoring_is_deterministic_and_bounded():
    parsed = {"contact": {"email": "a@b.co", "phone": "9999999999", "github": "github.com/x"}, "sections": ["education", "skills", "projects"],
              "bullets": ["Built a REST API serving 5000 users with Spring Boot", "Reduced latency by 40% using caching", "worked on stuff"], "skills": [{"name": "Java"}] * 9,
              "projects": [{"name": "p"}], "experience": [], "pageCount": 1, "wordCount": 400}
    checks = resume_checks(parsed, "Built things")
    s1, s2 = section_scores(parsed, checks), section_scores(parsed, checks)
    assert s1 == s2 and all(0 <= v <= 100 for v in s1.values())
    assert 0 <= overall(s1) <= 100
    assert METRIC.search("improved by 40%") and not METRIC.search("improved performance")


# ---------- code parsing ----------
PY = '''import os
from .utils import helper

class Svc:
    def run(self, x):
        return helper(x)

def top(a):
    return a + 1
'''

JAVA = '''package com.x;
import com.x.repo.UserRepository;
@Service
public class UserService {
    private final UserRepository repo;
    public User createUser(String email) {
        if (email == null) { throw new IllegalArgumentException(); }
        return repo.save(new User(email));
    }
    public User find(Long id) {
        return repo.findById(id).orElseThrow();
    }
}
'''

TS = '''import { api } from './lib/api'
export function loadUser(id: string) {
  return api.get(`/users/${id}`)
}
export const sum = (a: number, b: number) => {
  return a + b
}
'''


def test_python_symbols_and_imports():
    p = parse_file("a.py", "python", PY)
    qn = {s.qualified for s in p.symbols}
    assert {"Svc", "Svc.run", "top"} <= qn
    assert ".utils" in p.imports and "os" in p.imports
    assert any(c.symbol == "top" and c.start == 8 for c in p.chunks)


def test_java_class_methods_and_imports():
    p = parse_file("UserService.java", "java", JAVA)
    qn = {s.qualified for s in p.symbols}
    assert "UserService" in qn and "UserService.createUser" in qn and "UserService.find" in qn
    assert "com.x.repo.UserRepository" in p.imports
    cls = next(s for s in p.symbols if s.qualified == "UserService")
    assert cls.start <= 4 and cls.end == 13


def test_typescript_functions():
    p = parse_file("a.ts", "typescript", TS)
    assert {"loadUser", "sum"} <= {s.name for s in p.symbols}
    assert "./lib/api" in p.imports


def test_import_resolution():
    paths = {"src/lib/api.ts", "src/pages/a.tsx", "app/utils.py", "app/main.py", "src/main/java/com/x/repo/UserRepository.java"}
    suffix = {}
    for p in paths:
        parts = p.split("/")
        for i in range(len(parts)):
            suffix.setdefault("/".join(parts[i:]), p)
    assert resolve_import("../lib/api", "src/pages/a.tsx", "typescript", paths, suffix) == "src/lib/api.ts"
    assert resolve_import("react", "src/pages/a.tsx", "typescript", paths, suffix) is None
    assert resolve_import(".utils", "app/main.py", "python", paths, suffix) == "app/utils.py"
    assert resolve_import("com.x.repo.UserRepository", "x.java", "java", paths, suffix).endswith("UserRepository.java")


def test_identifier_splitting_for_lexical_search():
    assert "user" in split_identifiers("getUserById").split()


def test_stack_trace_parsing():
    java = "Exception in thread main java.lang.NullPointerException\n\tat com.x.UserService.createUser(UserService.java:42)\n\tat com.x.Ctl.post(Ctl.java:17)"
    py = 'Traceback (most recent call last):\n  File "app/main.py", line 10, in run\n    x()\nValueError: boom'
    js = "TypeError: x is undefined\n    at loadUser (src/lib/api.ts:12:5)"
    assert parse_stack_trace_text(java)[0]["line"] == 42
    assert parse_stack_trace_text(py)[0]["file"] == "app/main.py"
    assert parse_stack_trace_text(js)[0]["file"] == "src/lib/api.ts"
