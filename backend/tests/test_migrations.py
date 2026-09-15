"""The migrations and the models must describe exactly the same schema.

If someone edits a model and forgets to generate a migration, this fails.
"""

import asyncio

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base

pytestmark = pytest.mark.db


def _diff(sync_connection: Connection) -> list[object]:
    context = MigrationContext.configure(sync_connection, opts={"compare_type": True})
    differences: list[object] = list(compare_metadata(context, Base.metadata))
    return differences


async def _collect_diff(url: str) -> list[object]:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            return await connection.run_sync(_diff)
    finally:
        await engine.dispose()


def test_migrated_schema_matches_the_models(database: str) -> None:
    assert asyncio.run(_collect_diff(database)) == []


def test_expected_tables_exist(database: str) -> None:
    assert {"users", "texts"} <= set(Base.metadata.tables)
