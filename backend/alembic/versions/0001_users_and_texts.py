"""users and texts

Revision ID: 0001
Revises:
Create Date: 2026-09-15

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LANGUAGE = sa.Enum("he", "ar", "en", name="language", native_enum=False)
USER_ROLE = sa.Enum("user", "admin", name="user_role", native_enum=False)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("role", USER_ROLE, server_default="user", nullable=False),
        sa.Column("preferred_language", LANGUAGE, server_default="en", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "texts",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("language", LANGUAGE, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_normalized", sa.Text(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.SmallInteger(), nullable=False),
        sa.Column("source", sa.String(length=255), nullable=False),
        sa.Column("license", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_count > 0", name=op.f("ck_texts_char_count_positive")),
        sa.CheckConstraint("difficulty BETWEEN 1 AND 3", name=op.f("ck_texts_difficulty_range")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_texts_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_texts")),
    )
    op.create_index(
        "ix_texts_language_difficulty_is_active",
        "texts",
        ["language", "difficulty", "is_active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_texts_language_difficulty_is_active", table_name="texts")
    op.drop_table("texts")
    op.drop_table("users")
