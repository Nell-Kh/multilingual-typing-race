"""races and race results

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-17

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "races",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column(
            "language",
            sa.Enum("he", "ar", "en", name="language", native_enum=False),
            nullable=False,
        ),
        sa.Column("difficulty", sa.SmallInteger(), nullable=False),
        sa.Column("text_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("difficulty BETWEEN 1 AND 3", name=op.f("ck_races_difficulty_range")),
        sa.ForeignKeyConstraint(
            ["text_id"], ["texts.id"], name=op.f("fk_races_text_id_texts"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_races")),
    )
    op.create_table(
        "race_results",
        sa.Column("race_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("place", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "place IS NULL OR place >= 1", name=op.f("ck_race_results_place_positive")
        ),
        sa.ForeignKeyConstraint(
            ["race_id"],
            ["races.id"],
            name=op.f("fk_race_results_race_id_races"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["typing_sessions.id"],
            name=op.f("fk_race_results_session_id_typing_sessions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_race_results_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("race_id", "user_id", name=op.f("pk_race_results")),
    )
    op.create_foreign_key(
        op.f("fk_typing_sessions_race_id_races"),
        "typing_sessions",
        "races",
        ["race_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_typing_sessions_race_id_races"), "typing_sessions", type_="foreignkey"
    )
    op.drop_table("race_results")
    op.drop_table("races")
