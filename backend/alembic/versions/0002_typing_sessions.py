"""typing sessions and per-key stats

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LANGUAGE = sa.Enum("he", "ar", "en", name="language", native_enum=False)
SESSION_MODE = sa.Enum("practice", "race", "daily", name="session_mode", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "typing_sessions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("mode", SESSION_MODE, nullable=False),
        sa.Column("race_id", sa.Uuid(), nullable=True),
        sa.Column("language", LANGUAGE, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("wpm", sa.Float(), nullable=False),
        sa.Column("cpm", sa.Float(), nullable=False),
        sa.Column("raw_wpm", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("keystroke_count", sa.Integer(), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=False),
        sa.Column("invalid_reason", sa.String(length=64), nullable=True),
        sa.Column("keystrokes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "accuracy BETWEEN 0 AND 100", name=op.f("ck_typing_sessions_accuracy_range")
        ),
        sa.CheckConstraint("duration_ms > 0", name=op.f("ck_typing_sessions_duration_positive")),
        sa.ForeignKeyConstraint(
            ["text_id"],
            ["texts.id"],
            name=op.f("fk_typing_sessions_text_id_texts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_typing_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_typing_sessions")),
    )
    op.create_index(
        "ix_typing_sessions_language_is_valid_wpm",
        "typing_sessions",
        ["language", "is_valid", "wpm"],
        unique=False,
    )
    op.create_index(
        "ix_typing_sessions_user_id_started_at",
        "typing_sessions",
        ["user_id", "started_at"],
        unique=False,
    )
    op.create_table(
        "session_key_stats",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("key_char", sa.String(length=8), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("avg_latency_ms", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["typing_sessions.id"],
            name=op.f("fk_session_key_stats_session_id_typing_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("session_id", "key_char", name=op.f("pk_session_key_stats")),
    )


def downgrade() -> None:
    op.drop_table("session_key_stats")
    op.drop_index("ix_typing_sessions_user_id_started_at", table_name="typing_sessions")
    op.drop_index("ix_typing_sessions_language_is_valid_wpm", table_name="typing_sessions")
    op.drop_table("typing_sessions")
