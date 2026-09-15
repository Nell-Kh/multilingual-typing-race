import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.security import (
    InvalidTokenError,
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

# ---- passwords -----------------------------------------------------------------


def test_hash_is_not_the_password_and_differs_per_call() -> None:
    first, second = hash_password("s3cret"), hash_password("s3cret")

    assert "s3cret" not in first
    assert first != second  # a fresh random salt each time
    assert first.startswith("$argon2id$")


def test_verify_accepts_the_right_password_only() -> None:
    stored = hash_password("correct horse battery staple")

    assert verify_password("correct horse battery staple", stored)
    assert not verify_password("correct horse battery stapl", stored)
    assert not verify_password("", stored)


def test_verify_survives_garbage_in_the_database() -> None:
    assert not verify_password("anything", "not-a-real-hash")


def test_unicode_passwords_round_trip() -> None:
    stored = hash_password("סיסמה-كلمة-🙂")

    assert verify_password("סיסמה-كلمة-🙂", stored)


# ---- tokens --------------------------------------------------------------------

USER_ID = uuid.uuid4()


def test_access_token_round_trips() -> None:
    claims = decode_token(create_access_token(USER_ID), TokenType.ACCESS)

    assert claims.sub == USER_ID
    assert claims.type is TokenType.ACCESS
    assert claims.exp - claims.iat == timedelta(minutes=15)


def test_refresh_token_round_trips_and_exposes_its_jti() -> None:
    token, created = create_refresh_token(USER_ID)
    decoded = decode_token(token, TokenType.REFRESH)

    assert decoded.jti == created.jti
    assert decoded.exp - decoded.iat == timedelta(days=7)


def test_every_token_gets_a_unique_jti() -> None:
    _, a = create_refresh_token(USER_ID)
    _, b = create_refresh_token(USER_ID)

    assert a.jti != b.jti


def test_wrong_token_type_is_rejected() -> None:
    refresh, _ = create_refresh_token(USER_ID)

    with pytest.raises(InvalidTokenError, match="expected a access token"):
        decode_token(refresh, TokenType.ACCESS)
    with pytest.raises(InvalidTokenError, match="expected a refresh token"):
        decode_token(create_access_token(USER_ID), TokenType.REFRESH)


def test_expired_token_is_rejected() -> None:
    an_hour_ago = datetime.now(UTC) - timedelta(hours=1)
    token = create_access_token(USER_ID, now=an_hour_ago)  # 15-minute token, long dead

    with pytest.raises(InvalidTokenError, match="expired"):
        decode_token(token, TokenType.ACCESS)


def test_tampered_token_is_rejected() -> None:
    header, payload, signature = create_access_token(USER_ID).split(".")
    forged = ".".join([header, payload, signature[:-2] + "xx"])

    with pytest.raises(InvalidTokenError):
        decode_token(forged, TokenType.ACCESS)


@pytest.mark.parametrize("garbage", ["", "not.a.jwt", "a.b", "🙂"])
def test_garbage_is_rejected(garbage: str) -> None:
    with pytest.raises(InvalidTokenError):
        decode_token(garbage, TokenType.ACCESS)
