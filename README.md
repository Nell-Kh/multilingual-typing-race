# Multilingual Typing Race

A TypeRacer-style typing trainer for **Hebrew, Arabic and English**: practice alone or race friends in real time, track WPM / accuracy / weak keys over time, leaderboards per language, daily challenge.

**Live:** [web-production-1f908.up.railway.app](https://web-production-1f908.up.railway.app) · API health: [`/healthz`](https://api-production-57dab.up.railway.app/healthz)

> Status: **M0 complete** — walking skeleton deployed (frontend, API, Postgres, Redis, CI). No typing features yet; M1 adds auth and the text corpus.

## Stack

- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0 (async) + asyncpg, Alembic, PostgreSQL 16, Redis 7, arq
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, react-i18next
- **Infra:** Docker Compose (dev), GitHub Actions (CI), Railway (hosting)

## Run locally

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:8000 — health at `GET /healthz`, docs at `/docs`

Backend checks (needs Python 3.13):

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
ruff check . && mypy app tests && python -m pytest -q
```

Frontend checks (needs Node 24):

```bash
cd frontend && npm install
npm run lint && npm run typecheck && npm test && npm run build
```

## Repo layout

```
backend/    FastAPI app, tests, Dockerfile
frontend/   React + TS app, Dockerfile
infra/      docker-compose.yml
docs/       DECISIONS.md (ADRs), architecture, RTL notes
.github/    CI workflows
```

## Docs

- [Decision log](docs/DECISIONS.md) — every architectural choice, with its reasoning

## License

TBD
