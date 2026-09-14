# Decision log

Short ADR-style entries. One entry per decision; newest at the bottom. Never edit a past entry — supersede it with a new one.

Format: **Context** (why a decision was needed) → **Decision** → **Consequences** (what it costs / commits us to).

---

## ADR-001: Monorepo

- **Date:** 2026-09-14 · **Status:** accepted
- **Context:** Backend, frontend, infra and docs need to be versioned together and reviewed in one PR. A recruiter should need one clone.
- **Decision:** Single repo with `backend/`, `frontend/`, `infra/`, `docs/`, `.github/`.
- **Consequences:** One CI pipeline with a job per package. Tooling (ruff/mypy vs eslint/tsc) is scoped per directory. Slightly larger clone; no cross-repo versioning problems.

## ADR-002: Core stack

- **Date:** 2026-09-14 · **Status:** accepted
- **Context:** Real-time races need WebSockets and Redis pub/sub, which are asyncio-native. The project must also show real SQL and a mainstream TypeScript frontend on the CV.
- **Decision:**
  - Backend: FastAPI, SQLAlchemy 2.0 **async** + asyncpg, Alembic, Pydantic v2 + pydantic-settings.
  - DB: PostgreSQL 16. Cache / realtime: Redis 7. Background jobs: `arq`.
  - Frontend: React 18 + TypeScript + Vite, React Router, TanStack Query, Zustand, react-i18next, Recharts, Tailwind (logical properties).
  - Auth: argon2 + JWT (HS256), access 15 min in memory, refresh 7 days in httpOnly cookie.
  - Lint/test: ruff + mypy + pytest (backend), eslint + tsc strict + Vitest (frontend).
- **Consequences:** One async model end-to-end (no sync/async mixing). Analytics SQL is hand-written in `services/`, not ORM-generated. No Celery, no CSS-in-JS.

## ADR-003: Python 3.13

- **Date:** 2026-09-14 · **Status:** accepted (supersedes the 3.12 line in the original brief)
- **Context:** The dev machine has 3.13; every dependency in the stack publishes 3.13 wheels.
- **Decision:** Python 3.13 everywhere — `pyproject.toml` `requires-python`, the backend Dockerfile base image, and the CI matrix — pinned to the same minor version.
- **Consequences:** No local/CI/prod drift. If a dependency ever lags on 3.13, we downgrade in all three places at once.

## ADR-004: Hosting on Railway

- **Date:** 2026-09-14 · **Status:** accepted (closes the "Fly.io vs Railway" open decision)
- **Context:** M0 requires a public URL on day one. Fly.io needs a separate Redis provider and a separate frontend host; Railway offers Postgres + Redis as one-click services and auto-deploys from GitHub.
- **Decision:** Railway for API, worker, Postgres, Redis and the frontend. No `deploy.yml` in M0 — Railway deploys from `main` on its own. A GitHub Actions deploy step is added only when a release step (`alembic upgrade head`) is needed, in M1.
- **Consequences:** Fastest path to a public URL; one vendor to configure. Vendor lock-in is acceptable for a portfolio project. Cold starts / free-tier limits are a known risk to revisit at M6.

## ADR-005: Repo name `multilingual-typing-race`

- **Date:** 2026-09-14 · **Status:** accepted (replaces the `keylap` placeholder)
- **Context:** The brief used `keylap` as a placeholder and required a real, available name before launch.
- **Decision:** GitHub repo and all references use `multilingual-typing-race`. The product's display name can still be chosen at M6 without renaming the repo.
- **Consequences:** Descriptive, searchable, no trademark risk. Longer to type; package/image names are derived from it (`typing-race-api`, `typing-race-frontend`) where a short name is needed.

## ADR-006: Frontend versions follow the current Vite template

- **Date:** 2026-09-14 · **Status:** accepted (adjusts the "React 18 / eslint" line in ADR-002)
- **Context:** `npm create vite` (React + TS template) now ships React 19, TypeScript 6, Vite 8 and **oxlint** instead of eslint. Every library in ADR-002 (TanStack Query, Zustand, react-i18next, Recharts, Tailwind) supports React 19.
- **Decision:** Keep the template's versions: React 19, Vite 8, TS 6, oxlint for linting, Vitest 5 + Testing Library for tests. Do not downgrade to React 18 or swap oxlint for eslint.
- **Consequences:** Less config to maintain, faster lint. The CI frontend job runs `oxlint`, `tsc -b`, `vitest run`, `vite build`. If a library turns out to lack React 19 support, that is the moment to reconsider.

## ADR-007: Railway service layout and port handling

- **Date:** 2026-09-14 · **Status:** accepted (implements ADR-004)
- **Context:** Railway builds each service from a subdirectory of the monorepo, injects its own `$PORT`, and hands out `DATABASE_URL` in the `postgresql://` form that SQLAlchemy's async engine rejects.
- **Decision:**
  - Four Railway services in one project: `Postgres`, `Redis`, `api` (root `backend/`), `web` (root `frontend/`).
  - `railway.json` in `backend/` and `frontend/` pins the builder to the Dockerfile; the api service also declares `/healthz` as its healthcheck.
  - Both images listen on `$PORT` (api via the uvicorn command, web via an nginx config template rendered at start), defaulting to 8000 / 80 locally.
  - `Settings` rewrites `postgresql://` and `postgres://` to `postgresql+asyncpg://`, so the host's URL works unchanged. Unit-tested.
  - The frontend's API URL is baked in at build time via the `VITE_API_URL` build argument.
- **Consequences:** No host-specific code paths beyond config. Changing the api's public URL requires rebuilding the frontend, which is acceptable while both are on one platform; a runtime-config file would be the fix if that ever changes.
