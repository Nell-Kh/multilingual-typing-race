# End-to-end smoke test

One journey through the **built** frontend and a **real** API: register → practice
run → the server scores it → the run appears on the leaderboard, plus the daily
challenge opened from the home card and a reload that has to keep you signed in.

Nothing here is stubbed. That is the point: the bugs this exists to catch live
between the frontend and the backend, where both sides' unit tests are green and
the pages still disagree (see PR #29 and ADR-021).

It is its own npm package rather than part of `frontend/` so that Playwright —
and the browser it downloads — stays out of the image Railway builds.

## Running it

Needs Postgres and Redis up, the schema migrated and the corpus seeded.

```bash
# terminal 1 — the API, allowing the origin the browser will load the page from
cd backend && source .venv/bin/activate
alembic upgrade head && python -m app.cli seed-texts
CORS_ORIGINS=http://localhost:4173 uvicorn app.main:app --port 8000

# terminal 2 — build the frontend, then run the test
cd frontend && VITE_API_URL=http://localhost:8000 npm run build
cd ../e2e && npm ci && npx playwright install chromium && npm test
```

The config starts `vite preview` itself and waits for it. To point the test at a
server that is already running — a deployed one, say — set `WEB_URL` instead.

In CI this is the `e2e` job in `.github/workflows/ci.yml`; on failure it uploads
the Playwright trace and the API log.

## If registering starts failing with 429

The API rate-limits registrations per client address (ADR-022): 20 in 15 minutes
by default, and every account this test creates comes from the same address. A
dev stack you have been hammering will start refusing. Either wait out the
window, `redis-cli del ratelimit:auth:register:ip:127.0.0.1`, or start the API
with a ceiling suited to a test machine:

```bash
RATE_LIMIT_REGISTER_PER_IP=200 uvicorn app.main:app --port 8000
```

The CI job does the last of these — raised, not switched off, so the limiter is
still in the path the smoke test exercises.
