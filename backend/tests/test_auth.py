"""Register → login → me → refresh → logout, against the real app, database and Redis."""

import pytest
from httpx import AsyncClient

from app.api.auth import REFRESH_COOKIE, REFRESH_COOKIE_PATH

pytestmark = pytest.mark.db

AUTH = "/api/v1/auth"
NELL = {"email": "Nell@Example.com", "password": "correct horse battery", "display_name": "Nell"}


async def _register(client: AsyncClient, **overrides: str) -> dict[str, str]:
    r = await client.post(f"{AUTH}/register", json={**NELL, **overrides})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _cookie(refresh_token: str) -> dict[str, str]:
    """Send a refresh token explicitly. (Cookies put into httpx's jar by hand for the
    fake host "test" are silently not sent, so the header is the reliable way.)"""
    return {"Cookie": f"{REFRESH_COOKIE}={refresh_token}"}


# ---- register --------------------------------------------------------------------


async def test_register_returns_access_token_and_sets_refresh_cookie(
    app_client: AsyncClient,
) -> None:
    r = await app_client.post(f"{AUTH}/register", json=NELL)

    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 15 * 60
    assert body["access_token"].count(".") == 2

    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{REFRESH_COOKIE}=")
    assert "HttpOnly" in cookie
    assert f"Path={REFRESH_COOKIE_PATH}" in cookie


async def test_register_rejects_duplicate_email_case_insensitively(
    app_client: AsyncClient,
) -> None:
    await _register(app_client)

    r = await app_client.post(f"{AUTH}/register", json={**NELL, "email": "NELL@example.COM"})

    assert r.status_code == 409
    assert r.json() == {
        "error": {"code": "email_taken", "message": "An account with this email already exists"}
    }


@pytest.mark.parametrize(
    ("bad", "field"),
    [
        ({"email": "not-an-email"}, "email"),
        ({"password": "short"}, "password"),
        ({"display_name": "   "}, "display_name"),
        ({"display_name": "x" * 51}, "display_name"),
    ],
)
async def test_register_validation_errors_use_the_shared_shape(
    app_client: AsyncClient, bad: dict[str, str], field: str
) -> None:
    r = await app_client.post(f"{AUTH}/register", json={**NELL, **bad})

    assert r.status_code == 422
    error = r.json()["error"]
    assert error["code"] == "validation_error"
    assert [d["field"] for d in error["details"]] == [field]


# ---- login -----------------------------------------------------------------------


async def test_login_with_correct_password(app_client: AsyncClient) -> None:
    await _register(app_client)

    r = await app_client.post(
        f"{AUTH}/login", json={"email": "nell@example.com", "password": NELL["password"]}
    )

    assert r.status_code == 200
    assert r.json()["token_type"] == "bearer"


async def test_login_failures_are_indistinguishable(app_client: AsyncClient) -> None:
    await _register(app_client)

    wrong_password = await app_client.post(
        f"{AUTH}/login", json={"email": NELL["email"], "password": "nope nope nope"}
    )
    unknown_email = await app_client.post(
        f"{AUTH}/login", json={"email": "ghost@example.com", "password": NELL["password"]}
    )

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["error"]["code"] == "invalid_credentials"


# ---- me --------------------------------------------------------------------------


async def test_me_returns_the_user_without_secrets(app_client: AsyncClient) -> None:
    token = (await _register(app_client))["access_token"]

    r = await app_client.get(f"{AUTH}/me", headers=_bearer(token))

    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "nell@example.com"  # stored lower-cased
    assert body["display_name"] == "Nell"
    assert body["role"] == "user"
    assert body["preferred_language"] == "en"
    assert "password" not in body and "password_hash" not in body


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer garbage"}])
async def test_me_requires_a_valid_access_token(
    app_client: AsyncClient, headers: dict[str, str]
) -> None:
    r = await app_client.get(f"{AUTH}/me", headers=headers)

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


async def test_refresh_token_cannot_be_used_as_access_token(app_client: AsyncClient) -> None:
    await _register(app_client)
    refresh_cookie = app_client.cookies[REFRESH_COOKIE]

    r = await app_client.get(f"{AUTH}/me", headers=_bearer(refresh_cookie))

    assert r.status_code == 401


# ---- refresh ---------------------------------------------------------------------


async def test_refresh_issues_new_tokens_and_rotates_the_cookie(app_client: AsyncClient) -> None:
    first_access = (await _register(app_client))["access_token"]
    first_refresh = app_client.cookies[REFRESH_COOKIE]

    r = await app_client.post(f"{AUTH}/refresh")

    assert r.status_code == 200
    assert r.json()["access_token"] != first_access
    assert app_client.cookies[REFRESH_COOKIE] != first_refresh


async def test_reusing_an_old_refresh_token_is_rejected(app_client: AsyncClient) -> None:
    await _register(app_client)
    old = app_client.cookies[REFRESH_COOKIE]
    assert (await app_client.post(f"{AUTH}/refresh")).status_code == 200

    app_client.cookies.clear()  # drop the rotated cookie; send the old one by hand
    r = await app_client.post(f"{AUTH}/refresh", headers=_cookie(old))

    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Refresh token is no longer valid"


async def test_refresh_without_cookie_is_rejected(app_client: AsyncClient) -> None:
    r = await app_client.post(f"{AUTH}/refresh")

    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Missing refresh token"


# ---- logout ----------------------------------------------------------------------


async def test_logout_revokes_the_refresh_token(app_client: AsyncClient) -> None:
    await _register(app_client)
    refresh_before = app_client.cookies[REFRESH_COOKIE]

    r = await app_client.post(f"{AUTH}/logout")

    assert r.status_code == 204
    assert REFRESH_COOKIE not in app_client.cookies  # cookie cleared

    r = await app_client.post(f"{AUTH}/refresh", headers=_cookie(refresh_before))
    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Refresh token is no longer valid"


async def test_logout_without_a_session_is_still_fine(app_client: AsyncClient) -> None:
    assert (await app_client.post(f"{AUTH}/logout")).status_code == 204


# ---- error shape everywhere -----------------------------------------------------


async def test_unknown_route_uses_the_shared_error_shape(app_client: AsyncClient) -> None:
    r = await app_client.get("/api/v1/nope")

    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Not Found"}}
