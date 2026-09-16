"""Public text endpoints, admin CRUD, cursor pagination, and the seed command."""

import pytest
from httpx import AsyncClient

from app import cli
from app.seeds import en

pytestmark = pytest.mark.db

AUTH, TEXTS, ADMIN = "/api/v1/auth", "/api/v1/texts", "/api/v1/admin/texts"
SAMPLE = {
    "language": "en",
    "content": "“Quick” brown foxes — they’re fast.",
    "difficulty": 2,
    "source": "test",
    "license": "CC0-1.0",
}
NORMALIZED = '"Quick" brown foxes - they\'re fast.'


async def _token(client: AsyncClient, email: str, *, admin: bool, database: str) -> str:
    r = await client.post(
        f"{AUTH}/register",
        json={"email": email, "password": "correct horse battery", "display_name": "T"},
    )
    assert r.status_code == 201, r.text
    if admin:
        assert await cli.make_admin(email, database_url=database) == 0
        r = await client.post(
            f"{AUTH}/login", json={"email": email, "password": "correct horse battery"}
        )
    token: str = r.json()["access_token"]
    return token


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def seeded(app_client: AsyncClient, database: str) -> AsyncClient:
    assert await cli.seed_texts(database_url=database) == 0
    return app_client


# ---- random / get ----------------------------------------------------------------


async def test_random_returns_an_active_text_of_that_language(seeded: AsyncClient) -> None:
    r = await seeded.get(f"{TEXTS}/random", params={"lang": "en"})

    assert r.status_code == 200
    body = r.json()
    assert body["language"] == "en"
    assert body["char_count"] == len(body["content"])
    assert body["is_active"] is True
    assert "content_normalized" not in body  # internal detail, not exposed


async def test_random_respects_difficulty(seeded: AsyncClient) -> None:
    for _ in range(10):
        r = await seeded.get(f"{TEXTS}/random", params={"lang": "en", "difficulty": 3})
        assert r.json()["difficulty"] == 3


async def test_random_404_when_nothing_matches(seeded: AsyncClient) -> None:
    r = await seeded.get(f"{TEXTS}/random", params={"lang": "he"})

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


async def test_random_requires_a_valid_language(seeded: AsyncClient) -> None:
    assert (await seeded.get(f"{TEXTS}/random")).status_code == 422
    assert (await seeded.get(f"{TEXTS}/random", params={"lang": "fr"})).status_code == 422


async def test_get_by_id(seeded: AsyncClient) -> None:
    text = (await seeded.get(f"{TEXTS}/random", params={"lang": "en"})).json()

    r = await seeded.get(f"{TEXTS}/{text['id']}")

    assert r.status_code == 200
    assert r.json() == text


async def test_get_unknown_id_is_404(seeded: AsyncClient) -> None:
    r = await seeded.get(f"{TEXTS}/00000000-0000-0000-0000-000000000000")

    assert r.status_code == 404


# ---- admin -----------------------------------------------------------------------


async def test_admin_routes_need_the_admin_role(app_client: AsyncClient, database: str) -> None:
    user = await _token(app_client, "user@example.com", admin=False, database=database)

    assert (await app_client.post(f"{ADMIN}", json=SAMPLE)).status_code == 401
    r = await app_client.post(f"{ADMIN}", json=SAMPLE, headers=_bearer(user))

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


async def test_admin_create_normalizes_and_counts(app_client: AsyncClient, database: str) -> None:
    admin = await _token(app_client, "admin@example.com", admin=True, database=database)

    r = await app_client.post(f"{ADMIN}", json=SAMPLE, headers=_bearer(admin))

    assert r.status_code == 201, r.text
    body = r.json()
    # What you see is what you type: the stored text is the normalized form.
    assert body["content"] == NORMALIZED
    assert body["char_count"] == len(NORMALIZED)

    # And it is immediately servable.
    r = await app_client.get(f"{TEXTS}/random", params={"lang": "en", "difficulty": 2})
    assert r.json()["id"] == body["id"]


async def test_admin_update_and_soft_delete(app_client: AsyncClient, database: str) -> None:
    admin = await _token(app_client, "admin@example.com", admin=True, database=database)
    created = (await app_client.post(f"{ADMIN}", json=SAMPLE, headers=_bearer(admin))).json()
    url = f"{ADMIN}/{created['id']}"

    r = await app_client.put(url, json={"difficulty": 3}, headers=_bearer(admin))
    assert r.status_code == 200
    assert r.json()["difficulty"] == 3
    assert r.json()["content"] == NORMALIZED  # untouched fields stay

    assert (await app_client.delete(url, headers=_bearer(admin))).status_code == 204
    assert (await app_client.get(f"{TEXTS}/{created['id']}")).status_code == 404
    assert (await app_client.get(f"{TEXTS}/random", params={"lang": "en"})).status_code == 404
    # Still visible to admins, flagged inactive: nothing is ever hard-deleted.
    listed = (await app_client.get(ADMIN, headers=_bearer(admin))).json()["items"]
    assert [t["is_active"] for t in listed] == [False]


async def test_admin_list_pages_through_everything_exactly_once(
    seeded: AsyncClient, database: str
) -> None:
    admin = await _token(seeded, "admin@example.com", admin=True, database=database)
    seen: list[str] = []
    cursor: str | None = None
    pages = 0

    while True:
        params: dict[str, str | int] = {"limit": 12}
        if cursor:
            params["cursor"] = cursor
        r = await seeded.get(ADMIN, params=params, headers=_bearer(admin))
        assert r.status_code == 200, r.text
        page = r.json()
        seen += [t["id"] for t in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert pages == 3  # 30 seeds / 12 per page
    assert len(seen) == len(set(seen)) == len(en.ENTRIES)


async def test_admin_list_rejects_garbage_cursor(app_client: AsyncClient, database: str) -> None:
    admin = await _token(app_client, "admin@example.com", admin=True, database=database)

    r = await app_client.get(ADMIN, params={"cursor": "not-a-cursor"}, headers=_bearer(admin))

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_cursor"


# ---- cli -------------------------------------------------------------------------


async def test_seed_is_idempotent(
    app_client: AsyncClient, database: str, capsys: pytest.CaptureFixture[str]
) -> None:
    await cli.seed_texts(database_url=database)
    await cli.seed_texts(database_url=database)

    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith(f"seed-texts: {len(en.ENTRIES)} added")
    assert out[1].startswith("seed-texts: 0 added")


async def test_make_admin_unknown_email_fails(app_client: AsyncClient, database: str) -> None:
    assert await cli.make_admin("ghost@example.com", database_url=database) == 1
