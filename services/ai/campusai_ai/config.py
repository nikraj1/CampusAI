"""Runtime configuration (environment variables / .env)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


def load_env_files() -> None:
    """Export KEY=VALUE pairs from .env files into os.environ (without overriding real env vars).
    pydantic-settings reads .env only for its own fields; the LLM gateway reads provider keys from os.environ."""
    import os

    for p in (Path.cwd() / ".env", ROOT / ".env", ROOT.parent.parent / ".env"):
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


load_env_files()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    db_dsn: str = "postgresql://campusai:campusai@localhost:5432/campusai"
    ai_service_jwt_secret: str = "dev-only-service-secret-change-me-0123456789abcdef"
    file_storage_dir: str = "../api/data/files"
    worker_embedded: bool = True
    worker_id: str = "worker-1"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_cache: str = str(ROOT / ".cache" / "fastembed")
    llm_config_path: str = str(ROOT / "campusai_ai" / "llm" / "llm.yaml")
    per_user_daily_tokens: int = 400_000
    # retrieval
    sufficient_score: float = 0.60
    insufficient_score: float = 0.38
    max_rewrites: int = 1
    reranker_enabled: bool = False
    # repo ingestion
    git_binary: str = "git"
    max_repo_kb: int = 100_000
    max_repo_files: int = 3000
    repo_tmp_dir: str = str(ROOT / ".tmp" / "repos")


@lru_cache
def get_settings() -> Settings:
    return Settings()
