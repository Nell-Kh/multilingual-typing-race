from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Without this, PostgreSQL invents names for indexes and constraints and Alembic
# cannot reliably drop or alter them later. Naming them by rule keeps migrations
# deterministic and readable.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Parent class of every model; carries the shared metadata."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
