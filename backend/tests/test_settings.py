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


def test_prod_refuses_the_default_jwt_secret() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(app_env="prod")


def test_prod_accepts_a_real_jwt_secret() -> None:
    assert Settings(app_env="prod", jwt_secret="x" * 32).jwt_secret == "x" * 32


def test_short_jwt_secret_is_rejected_everywhere() -> None:
    with pytest.raises(ValueError, match="at least 32"):
        Settings(jwt_secret="too-short")
