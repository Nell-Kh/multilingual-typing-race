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

    # Rate limiting on the auth endpoints (ADR-022). Counters are per client address,
    # except the login one that counts failures per email address. The ceilings are
    # deliberately far above what a person does and far below what a script does, so
    # they can stay on without anyone noticing them.
    rate_limit_enabled: bool = True
    rate_limit_window_seconds: int = 900
    rate_limit_register_per_ip: int = 20
    rate_limit_login_per_ip: int = 40
    rate_limit_login_failures_per_email: int = 10
    rate_limit_refresh_per_ip: int = 120

    # Race timing (docs/race-protocol.md §2, §5, §6). Tests shrink these to milliseconds.
    race_countdown_seconds: float = 3.0
    race_finish_grace_seconds: float = 60.0  # race ends this long after the first finish
    race_max_seconds: float = 300.0  # ... or this long after it started, whatever comes first
    room_idle_ttl_seconds: int = 600  # lobby / finished rooms expire after this much silence
    lobby_disconnect_grace_seconds: float = 10.0  # a refresh in the lobby is not a leave
    ws_auth_timeout_seconds: float = 5.0

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
