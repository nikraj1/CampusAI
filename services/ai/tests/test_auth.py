"""Service-JWT security tests (no DB needed)."""
import time

import jwt
import pytest
from fastapi import HTTPException

from campusai_ai.auth import decode_service_token
from campusai_ai.config import get_settings


def tok(**over):
    s = get_settings()
    claims = {"sub": "11111111-1111-1111-1111-111111111111", "aud": "campusai-ai", "iss": "campusai-api", "exp": int(time.time()) + 60, "privateMode": True}
    claims.update(over)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, over.get("_key", s.ai_service_jwt_secret), algorithm="HS256")


def test_valid_token_yields_principal():
    p = decode_service_token(tok())
    assert p.user_id.startswith("1111") and p.private_mode is True


@pytest.mark.parametrize("bad", [dict(aud="other"), dict(iss="evil"), dict(exp=int(time.time()) - 5), dict(sub=None)])
def test_invalid_claims_rejected(bad):
    with pytest.raises(HTTPException) as e:
        decode_service_token(tok(**bad))
    assert e.value.status_code == 401


def test_wrong_secret_rejected():
    t = jwt.encode({"sub": "x", "aud": "campusai-ai", "iss": "campusai-api", "exp": int(time.time()) + 60}, "a-different-secret-that-is-long-enough-123456", algorithm="HS256")
    with pytest.raises(HTTPException):
        decode_service_token(t)


def test_none_algorithm_rejected():
    t = jwt.encode({"sub": "x", "aud": "campusai-ai", "iss": "campusai-api", "exp": int(time.time()) + 60}, None, algorithm="none")
    with pytest.raises(HTTPException):
        decode_service_token(t)
