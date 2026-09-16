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

## ADR-008: Database conventions

- **Date:** 2026-09-15 · **Status:** accepted
- **Context:** The first tables (`users`, `texts`) fix conventions every later table will follow, and getting them wrong is expensive once data exists.
- **Decision:**
  - **UUID primary keys**, defaulted both in Python (`uuid4`) and in PostgreSQL (`gen_random_uuid()`). User ids appear in URLs, and sequential integers would let anyone count and enumerate accounts.
  - **Enums stored as VARCHAR with a CHECK constraint** (`native_enum=False`), not native PostgreSQL enum types. Adding a language later is then an ordinary migration instead of an `ALTER TYPE`.
  - **Constraint naming convention** set on the shared `MetaData`, so every index, foreign key and check has a predictable name and Alembic can always alter or drop it.
  - **Timestamps are `TIMESTAMPTZ`** defaulted by the database, never by the application clock.
  - **Emails are stored lower-cased** by the application; the plain unique index is then effectively case-insensitive.
  - **Migrations are the source of truth for the schema**, and a test asserts the models and the migrations agree (`tests/test_migrations.py`), so a model edit without a migration fails CI.
- **Consequences:** Slightly larger indexes than integer keys, which is irrelevant at this scale. Schema drift is caught automatically. Integration tests run against a throwaway `<dbname>_test` database and skip when no PostgreSQL is reachable, so `pytest` still works on a laptop with nothing running.

## ADR-009: Auth design

- **Date:** 2026-09-15 · **Status:** accepted
- **Context:** M1 needs login that is safe to explain in an interview and works with the frontend and API on different hosts.
- **Decision:**
  - Passwords hashed with **argon2id**; never stored or logged in clear.
  - **Access token**: JWT (HS256), 15 min, returned in the response body, sent as `Authorization: Bearer`. Stateless — verified by signature alone.
  - **Refresh token**: JWT, 7 days, in an **httpOnly cookie** scoped to `/api/v1/auth` so browsers send it nowhere else. `SameSite=None; Secure` in prod (cross-host), `Lax` locally.
  - Every refresh token's `jti` is stored in **Redis** with the token's TTL. Refresh **rotates** (old `jti` deleted atomically with `GETDEL`, new one issued), so a reused or stolen refresh token is rejected; logout deletes the `jti`.
  - Register logs the user in (same response as login). Unknown email and wrong password return the identical 401.
  - `JWT_SECRET` ≥ 32 chars, mandatory when `APP_ENV=prod`; the app refuses to start without it.
  - One error shape for every failure: `{"error": {"code", "message"}}`.
- **Consequences:** No server-side session table; only refresh ids live in Redis. Losing Redis logs everyone out at their next refresh (acceptable). The prod-secret guard is deliberately fatal: it took the API down when PR #8 was merged before the variable was set — the fix is to set the variable, not to soften the guard. Rate limiting on auth endpoints is deferred to the M6 security pass.

## ADR-010: Migrations run as a Railway pre-deploy command

- **Date:** 2026-09-15 · **Status:** accepted (replaces the `deploy.yml` idea in ADR-004)
- **Context:** Every deploy of new code that touches the schema must apply migrations first, exactly once.
- **Decision:** The `api` service's Railway **Pre-Deploy Command** is `alembic upgrade head`. Railway runs it in the new image before swapping traffic; if it fails, the old version keeps serving. Locally, `docker compose` runs the same command before starting uvicorn.
- **Consequences:** No GitHub Actions deploy workflow needed. The migration files must ship in the image (they do: `COPY alembic ./alembic`). A migration that fails leaves prod on the previous version and shows the error in Railway's deploy logs.

## ADR-011: Cursor pagination and soft deletes

- **Date:** 2026-09-15 · **Status:** accepted (closes the "M1: cursor pagination style" open decision)
- **Context:** Admin lists (texts now; sessions and leaderboards later) need paging that stays correct while rows are being added, and texts will be referenced by typing sessions, so removing one must not orphan history.
- **Decision:**
  - **Keyset pagination** on `(created_at DESC, id DESC)`; the cursor is an opaque url-safe base64 of those two values. Clients pass it back as `?cursor=`; a malformed one is a 400 `invalid_cursor`. `limit` defaults to 20, max 100. Implemented once in `app/core/pagination.py`.
  - **Soft delete**: `DELETE /admin/texts/{id}` sets `is_active=false`. Public endpoints only serve active texts; admins still see everything.
  - `GET /texts/random` uses `ORDER BY random() LIMIT 1` — correct and simple for a corpus of hundreds; revisit only if it ever reaches millions.
  - `content_normalized` and `char_count` are computed server-side from `content` on every create/update via `app/i18n/normalize.py`; clients never send them.
  - Seed corpus: original sentences released CC0, imported by `python -m app.cli seed-texts`, idempotent (matched on normalized content). Admin promotion is a CLI command, not an endpoint.
- **Consequences:** No offset paging anywhere. Deleted texts keep their ids forever. The English normalization rules live in one function that M3 extends for Hebrew and Arabic.

## ADR-012: Typing engine and the server-as-judge rule

- **Date:** 2026-09-16 · **Status:** accepted
- **Context:** M2 needs a typing engine that produces a log the server can score and validate, works with real keyboards (mobile, IME), and can later render Hebrew/Arabic without breaking letter shaping.
- **Decision:**
  - **The engine is a pure reducer** (`frontend/src/features/typing-engine/engine.ts`): no DOM, no timers. It receives the whole input value on each change, diffs it against the previous value, and emits keystrokes as `[t_ms, expected, typed]` with `"\b"` for backspace — byte-for-byte the format `backend/app/services/typing_metrics.py` scores. Timestamps are relative to the first keystroke.
  - **You cannot type past a mistake.** A wrong character is accepted (so it is logged as an error) but nothing after it until it is backspaced. This keeps the final text equal to the target, which the validator requires, and matches TypeRacer's behaviour.
  - **Input comes from a real `<input>`** laid transparently over the display, so mobile keyboards, IME composition (`compositionstart/end`) and accessibility work. Paste is blocked client-side; the validator would reject it anyway.
  - **The browser never sends numbers.** `POST /sessions` gets `{text_id, started_at, keystrokes}` and nothing else; a test asserts the request body has exactly those keys. Live WPM/accuracy in the UI use the same formulas as the server but are display-only.
  - **Per-character `<span>`s for the English renderer.** They break Arabic shaping; M3 replaces the renderer (overlay caret via `Range.getBoundingClientRect()`) and leaves the engine untouched — that is why the engine is renderer-agnostic.
  - Practice starts the clock at the first keystroke, not when the text appears.
- **Consequences:** Engine and validator are both unit-tested against the same log format (28 frontend tests, 33 backend tests for metrics + validator). Any future client (mobile app, race mode) reuses the engine unchanged. A user who mistypes must fix it, which is stricter than Monkeytype's "keep going" mode; revisit only if user feedback demands it.

## ADR-013: Normalization rules for Hebrew and Arabic ("what you see is what you type")

- **Date:** 2026-09-16 · **Status:** accepted
- **Context:** M3 adds Hebrew and Arabic texts. Both scripts carry optional marks (niqqud / tashkeel) that nobody types in everyday writing, and typographic punctuation (׳ ״ ־, curly quotes) that is not on a keyboard. The validator compares keystrokes to `content_normalized`, but the frontend displayed `content`, so any difference between the two would make a text impossible to finish.
- **Decision:**
  - `app/i18n/normalize.py` is the single source of truth. All languages: NFKC, drop invisible bidi/zero-width characters, curly quotes and guillemets → `'`/`"`, en/em dashes → `-`, collapse whitespace. Hebrew: strip niqqud and cantillation (combining marks in U+0590–U+05FF), geresh/gershayim/maqaf/sof pasuq → `'`/`"`/`-`/`:`, Yiddish ligatures unfold, **final letters are never folded** (ך ≠ כ). Arabic: strip tashkeel, superscript alef and Quranic marks (combining marks in the Arabic blocks), strip tatweel, alef wasla → ا, Persian/Urdu look-alikes (ک ی ھ) → the Arabic letters, ASCII `,` `;` `?` → `،` `؛` `؟` (what the Arabic 101 keyboard types and how Arabic is written), **strict letters** (أ ≠ ا, ة ≠ ه, ى ≠ ي).
  - **The display text is the typing target.** Since M3 the `content` column is stored already normalized (identical to `content_normalized`), so what the player sees is exactly what the validator expects. `content_normalized` stays as the dedup key for seeds; no migration, because both columns already exist and the data (all ASCII English) is unchanged.
  - Corpus rule: he/ar seed texts are unpointed and contain no Latin letters or digits (no mixed-direction runs in v1).
- **Consequences:** Authors may paste vowelled or typographically fancy text; the importer flattens it. An unpointed Hebrew text and its pointed twin dedupe to one row. Folding (accepting ه for ة) would be a one-line change in one function if learners ask for a lenient mode later. 32 normalization tests document every rule with a concrete example.
