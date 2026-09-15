from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/settings.py -> repo root is three levels up
_REPO_ROOT = Path(__file__).resolve().parents[3]

DEV_JWT_SECRET = "dev-only-secret-not-for-production-use"


class Settings(BaseSettings):
    """All configuration comes from environment variables (or the root .env file).

    Variable names match .env.example exactly (case-insensitive).
    """

    model_config = SettingsConfigDict(
        env_file=_REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        # `JWT_SECRET=` left blank in .env means "use the default", not "use empty string".
        env_ignore_empty=True,
        extra="ignore",
    )

    app_env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"

    database_url: str = "postgresql+asyncpg://typing:typing@localhost:5432/typing"
    redis_url: str = "redis://localhost:6379/0"

    # Signs every token. The default only exists so dev and tests run without setup;
    # in prod a real secret is mandatory (checked below). HS256 wants >= 32 bytes.
    jwt_secret: str = Field(default=DEV_JWT_SECRET, min_length=32)
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg_driver(cls, value: str) -> str:
        """Hosts hand out `postgresql://` URLs; SQLAlchemy's async engine needs `+asyncpg`."""
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def _require_real_secret_in_prod(self) -> "Settings":
        if self.app_env == "prod" and self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError("JWT_SECRET must be set to a real secret when APP_ENV=prod")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
