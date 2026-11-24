"""Service-JWT verification: the acting user comes ONLY from the signed `sub` claim, never the request body."""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from .config import get_settings

AUDIENCE = "campusai-ai"
ISSUER = "campusai-api"


@dataclass(frozen=True)
class Principal:
    user_id: str
    private_mode: bool = False
    request_id: str = ""


def decode_service_token(token: str) -> Principal:
    s = get_settings()
    try:
        claims = jwt.decode(token, s.ai_service_jwt_secret, algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER)
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail={"code": "INVALID_SERVICE_TOKEN", "message": str(e), "retryable": False})
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail={"code": "INVALID_SERVICE_TOKEN", "message": "missing sub", "retryable": False})
    return Principal(user_id=str(sub), private_mode=bool(claims.get("privateMode", False)), request_id=str(claims.get("requestId", "")))


async def require_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "MISSING_SERVICE_TOKEN", "message": "Authorization required", "retryable": False})
    return decode_service_token(authorization[7:])
