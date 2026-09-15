"""Shared test fixtures.

Integration tests run against a throwaway database (`<dbname>_test`) so they can
drop and recreate the schema without touching development data. When no
PostgreSQL is reachable they skip rather than fail, so `pytest` still works on a
machine with nothing running; CI always has a database, so nothing is skipped there.
"""

import asyncio
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.settings import get_settings

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = make_url(get_settings().database_url)
    # str(url) would mask the password as "***"; render it for real.
    return url.set(database=f"{url.database}_test").render_as_string(hide_password=False)


async def _create_database_if_missing(url_str: str) -> None:
    url = make_url(url_str)
    admin_url = url.set(database="postgres").render_as_string(hide_password=False)
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        await admin.dispose()


async def _reset_schema(url_str: str) -> None:
    engine = create_async_engine(url_str, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def database(test_database_url: str) -> str:
    """An empty database with the schema at the latest migration."""
    try:
        asyncio.run(_create_database_if_missing(test_database_url))
    except Exception as exc:  # noqa: BLE001 - any connection problem means "no database here"
        pytest.skip(f"no PostgreSQL reachable: {exc}")

    asyncio.run(_reset_schema(test_database_url))
    upgrade_to_head(test_database_url)
    return test_database_url


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # Passed via attributes, not the ini file: a password containing '%' would
    # break configparser's interpolation.
    config.attributes["sqlalchemy_url"] = url
    return config


def upgrade_to_head(url: str) -> None:
    from alembic import command

    command.upgrade(alembic_config(url), "head")
