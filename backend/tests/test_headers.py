"""Security headers on every response (ADR-026)."""

import pytest
from httpx import AsyncClient

from app.core.headers import HEADERS

from .conftest import AppClientFactory

pytestmark = pytest.mark.db


async def test_every_response_carries_the_headers(app_client: AsyncClient) -> None:
    # A 200, a 404 and a validation error all go through the same middleware.
    for response in (
        await app_client.get("/healthz"),
        await app_client.get("/api/v1/nope"),
        await app_client.post("/api/v1/auth/login", json={}),
    ):
        for name, value in HEADERS.items():
            assert response.headers[name] == value, f"{name} missing on {response.status_code}"


async def test_hsts_is_sent_in_prod_only(app_client_factory: AppClientFactory) -> None:
    """A local http server that sent HSTS would pin the browser to https://localhost."""
    async with app_client_factory() as dev:  # app_env="test"
        assert "strict-transport-security" not in (await dev.get("/healthz")).headers

    async with app_client_factory(
        app_env="prod", jwt_secret="x" * 40, cors_origins="https://example.com"
    ) as prod:
        assert (
            (await prod.get("/healthz"))
            .headers["Strict-Transport-Security"]
            .startswith("max-age=31536000")
        )


async def test_a_route_header_survives_the_middleware(
    app_client_factory: AppClientFactory,
) -> None:
    """Retry-After is set by the rate limiter; the middleware adds to a response,
    it does not rewrite one."""
    async with app_client_factory(rate_limit_register_per_ip=1) as client:
        body = {"email": "a@example.com", "password": "correct horse battery", "display_name": "A"}
        assert (await client.post("/api/v1/auth/register", json=body)).status_code == 201

        refused = await client.post("/api/v1/auth/register", json={**body, "email": "b@x.com"})

        assert refused.status_code == 429
        assert int(refused.headers["Retry-After"]) > 0
        assert refused.headers["X-Frame-Options"] == "DENY"
