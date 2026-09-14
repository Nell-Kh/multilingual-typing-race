import pytest

from app.core.settings import Settings


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        # What a hosting provider hands us.
        (
            "postgresql://u:p@host:5432/db",
            "postgresql+asyncpg://u:p@host:5432/db",
        ),
        # The older scheme some providers still use.
        (
            "postgres://u:p@host:5432/db",
            "postgresql+asyncpg://u:p@host:5432/db",
        ),
        # Already correct: left alone.
        (
            "postgresql+asyncpg://u:p@host:5432/db",
            "postgresql+asyncpg://u:p@host:5432/db",
        ),
    ],
)
def test_database_url_always_uses_the_async_driver(given: str, expected: str) -> None:
    assert Settings(database_url=given).database_url == expected


def test_cors_origins_splits_on_commas_and_trims() -> None:
    settings = Settings(cors_origins="https://a.example , https://b.example")

    assert settings.cors_origin_list == ["https://a.example", "https://b.example"]
