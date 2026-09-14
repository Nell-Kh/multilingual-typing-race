# Multilingual Typing Race

A TypeRacer-style typing trainer for **Hebrew, Arabic and English**: practice alone or race friends in real time, track WPM / accuracy / weak keys over time, leaderboards per language, daily challenge.

> Status: **M0 — walking skeleton** (not deployed yet). This README is a stub and will be completed at launch.

## Stack

- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0 (async) + asyncpg, Alembic, PostgreSQL 16, Redis 7, arq
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, react-i18next
- **Infra:** Docker Compose (dev), GitHub Actions (CI), Railway (hosting)

## Run locally

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

- API: http://localhost:8000 (health: `GET /healthz`)
- Frontend: http://localhost:5173

## Repo layout

```
backend/    FastAPI app, tests, Dockerfile
frontend/   React + TS app, Dockerfile
infra/      docker-compose.yml
docs/       DECISIONS.md (ADRs), architecture, RTL notes
.github/    CI workflows
```

## Docs

- [Decision log](docs/DECISIONS.md)

## License

TBD
