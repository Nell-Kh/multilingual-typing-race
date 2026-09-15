"""Password hashing and signed tokens. Pure functions, no I/O.

Passwords: argon2id, the current recommended algorithm. The hash embeds its own
salt and parameters, so verifying needs nothing but the stored string.

Tokens: JWT (a signed, base64 JSON blob). An *access* token is short-lived and
sent with every request; a *refresh* token is long-lived, kept in an httpOnly
cookie, and only used to mint a new access token. Both carry a `jti` (unique id)
so a refresh token can be revoked server-side on logout.
"""

import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from pydantic import BaseModel, ValidationError

from app.core.settings import get_settings

_hasher = PasswordHasher()
_ALGORITHM = "HS256"


# ---- passwords -----------------------------------------------------------------


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


# ---- tokens --------------------------------------------------------------------


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"


class TokenClaims(BaseModel):
    """What a valid token says. `sub` is the user id."""

    sub: uuid.UUID
    type: TokenType
    jti: uuid.UUID
    iat: datetime
    exp: datetime


class InvalidTokenError(Exception):
    """Expired, tampered with, malformed, or the wrong kind of token."""


def _create_token(
    user_id: uuid.UUID, token_type: TokenType, lifetime: timedelta, *, now: datetime | None = None
) -> tuple[str, TokenClaims]:
    issued_at = now or datetime.now(UTC)
    claims = TokenClaims(
        sub=user_id,
        type=token_type,
        jti=uuid.uuid4(),
        iat=issued_at,
        exp=issued_at + lifetime,
    )
    payload = {
        "sub": str(claims.sub),
        "type": claims.type.value,
        "jti": str(claims.jti),
        "iat": int(claims.iat.timestamp()),
        "exp": int(claims.exp.timestamp()),
    }
    token = jwt.encode(payload, get_settings().jwt_secret, algorithm=_ALGORITHM)
    return token, claims


def create_access_token(user_id: uuid.UUID, *, now: datetime | None = None) -> str:
    lifetime = timedelta(minutes=get_settings().access_token_minutes)
    token, _ = _create_token(user_id, TokenType.ACCESS, lifetime, now=now)
    return token


def create_refresh_token(
    user_id: uuid.UUID, *, now: datetime | None = None
) -> tuple[str, TokenClaims]:
    """Returns the claims too: the caller stores `jti` so the token can be revoked."""
    lifetime = timedelta(days=get_settings().refresh_token_days)
    return _create_token(user_id, TokenType.REFRESH, lifetime, now=now)


def decode_token(token: str, expected_type: TokenType) -> TokenClaims:
    """Verify signature and expiry, then check it is the kind of token we expect."""
    try:
        payload = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[_ALGORITHM],
            options={"require": ["sub", "type", "jti", "iat", "exp"]},
        )
        claims = TokenClaims.model_validate(payload)
    except (jwt.PyJWTError, ValidationError) as exc:
        raise InvalidTokenError(str(exc)) from exc
    if claims.type != expected_type:
        raise InvalidTokenError(f"expected a {expected_type} token, got {claims.type}")
    return claims
