"""Maintenance commands. Run from backend/:

python -m app.cli seed-texts            # import the seed corpus (safe to re-run)
python -m app.cli make-admin EMAIL      # promote an existing user to admin
"""

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.db.session import create_engine, create_session_factory
from app.models import User, UserRole
from app.seeds import en
from app.services.texts import upsert_seed


async def seed_texts(database_url: str | None = None) -> int:
    engine = create_engine(database_url)
    try:
        async with create_session_factory(engine)() as session:
            added = await upsert_seed(session, en.ENTRIES)
    finally:
        await engine.dispose()
    print(f"seed-texts: {added} added, {len(en.ENTRIES) - added} already present")
    return 0


async def make_admin(email: str, database_url: str | None = None) -> int:
    engine = create_engine(database_url)
    try:
        async with create_session_factory(engine)() as session:
            user = await session.scalar(select(User).where(User.email == email.lower()))
            if user is None:
                print(f"make-admin: no user with email {email!r}", file=sys.stderr)
                return 1
            user.role = UserRole.ADMIN
            await session.commit()
    finally:
        await engine.dispose()
    print(f"make-admin: {email} is now an admin")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-texts", help="import the seed corpus")
    make = sub.add_parser("make-admin", help="promote a user to admin")
    make.add_argument("email")
    args = parser.parse_args(argv)

    if args.command == "seed-texts":
        return asyncio.run(seed_texts())
    return asyncio.run(make_admin(args.email))


if __name__ == "__main__":
    sys.exit(main())
