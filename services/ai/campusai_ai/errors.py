"""Typed errors that map to {code, message, retryable} responses."""
from __future__ import annotations


class AppError(Exception):
    status = 500

    def __init__(self, code: str, message: str, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        if status is not None:
            self.status = status

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


class LLMError(AppError):
    status = 503


class NotConfigured(LLMError):
    def __init__(self) -> None:
        super().__init__(
            "LLM_NOT_CONFIGURED",
            "No LLM provider is configured. Set GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or run Ollama (see README).",
            retryable=False,
        )


class NotFound(AppError):
    status = 404

    def __init__(self, what: str):
        super().__init__("NOT_FOUND", f"{what} not found")


class BadInput(AppError):
    status = 422

    def __init__(self, message: str, code: str = "BAD_INPUT"):
        super().__init__(code, message)
