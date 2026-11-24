"""Local embeddings (fastembed / ONNX). Runs on CPU, so ingestion never consumes LLM API quota."""
from __future__ import annotations

import asyncio
import threading

import numpy as np

from .config import get_settings

QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
DIM = 384


class Embedder:
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from fastembed import TextEmbedding

                    s = get_settings()
                    self._model = TextEmbedding(model_name=s.embedding_model, cache_dir=s.embedding_cache)
        return self._model

    def embed_passages_sync(self, texts: list[str], batch_size: int = 32) -> list[np.ndarray]:
        if not texts:
            return []
        m = self._load()
        return [np.asarray(v, dtype=np.float32) for v in m.embed(texts, batch_size=batch_size)]

    def embed_query_sync(self, text: str) -> np.ndarray:
        m = self._load()
        return np.asarray(next(iter(m.embed([QUERY_PREFIX + text]))), dtype=np.float32)

    async def embed_passages(self, texts: list[str]) -> list[np.ndarray]:
        return await asyncio.to_thread(self.embed_passages_sync, texts)

    async def embed_query(self, text: str) -> np.ndarray:
        return await asyncio.to_thread(self.embed_query_sync, text)

    async def embed_plain(self, texts: list[str]) -> list[np.ndarray]:
        """Symmetric (no query prefix) embeddings, e.g. for sentence-to-sentence similarity."""
        return await asyncio.to_thread(self.embed_passages_sync, texts)

    def warm_up(self) -> None:
        self._load()
        self.embed_query_sync("warm up")


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    d = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / d) if d else 0.0


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = Embedder()
    return _embedder


def set_embedder(e: Embedder | None) -> None:
    global _embedder
    _embedder = e
