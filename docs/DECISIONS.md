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

## ADR-014: Hebrew and Arabic rendering keeps per-character spans

- **Date:** 2026-09-16 · **Status:** accepted (revises the renderer plan in ADR-012)
- **Context:** ADR-012 assumed that one `<span>` per character breaks Arabic letter joining and planned an overlay renderer for M3 (whole-word text nodes, caret placed with `Range.getBoundingClientRect()`). Before writing it we measured: in Chromium a per-character Arabic sentence is pixel-identical in width to the same sentence as one text node, with letters joined, as long as all spans share the same font properties. Firefox has shaped across inline boundaries for years; WebKit fixed it for complex scripts in late 2025 (bug 6148).
- **Decision:**
  - Keep the per-character renderer for all three languages. Per-language differences are only `dir`, `lang`, and the font selected by CSS `:lang()`.
  - Fonts are self-hosted via `@fontsource/noto-sans`, `noto-sans-hebrew`, `noto-naskh-arabic` (one script subset each, ~13–53 KB per file); no requests to Google Fonts. Nothing in the typing box is monospace.
  - Invariants documented in `docs/rtl-notes.md`: identical font properties on every span, no `letter-spacing`, no `inline-block` per character.
  - The practice-text language is a picker on the practice page, remembered in `localStorage`; it is independent of the UI language.
- **Consequences:** No second renderer to maintain, and the 17 engine tests plus the TypingBox tests cover all languages with one code path. A browser that does not shape across spans would show disconnected Arabic letters — acceptable given current browser support; the overlay design stays documented as the fallback if that ever changes.

## ADR-015: The median-gap check needs a sample

- **Date:** 2026-09-16 · **Status:** accepted (refines the validator rules in ADR-012)
- **Context:** An external review pointed out that `median_gap_too_low` ran on any log length. A median of a handful of gaps is noise: a fast typist on a short Hebrew or Arabic text (fewer characters for the same content) could be rejected, and the failure would surface as a stored invalid row nobody understands.
- **Decision:** The median rule applies only once there are at least 20 gaps (`MIN_GAPS_FOR_MEDIAN`). The machine-run rule (10 consecutive keys ≤ 5 ms apart) is deliberately **not** gated: it is about consecutive keys, not a statistic, and it is what catches a paste of a short text. The client-side `onPaste` block in `TypingBox` is a convenience, not a defence; the validator is.
- **Consequences:** Two new tests pin the boundary (20 gaps skip, 21 apply) and prove a pasted 12-character text is still rejected. Corpus texts are all ≥ 30 characters, so in practice the median rule still runs on every seeded text.

## ADR-016: You cannot type past a mistake

- **Date:** 2026-09-16 · **Status:** accepted (restates one rule from ADR-012 so it is findable)
- **Context:** Two external reviews asked where this rule was recorded; it was one bullet inside ADR-012 and got missed both times. It changes what "accuracy" means compared with other typing sites, so it deserves its own entry.
- **Decision:** After a wrong character the engine accepts that character (so the error is logged) and then refuses further input until it is backspaced. The final text therefore always equals the target when the run ends; the validator's `text_mismatch` rule relies on this. Accuracy is `correct / (correct + errors)` over *keystrokes*, so a corrected mistake still costs accuracy, and there is no penalty-per-uncorrected-error because uncorrected errors cannot exist.
- **Consequences:** Stricter than Monkeytype's default and closer to TypeRacer. Learners must fix mistakes, which is the behaviour a trainer wants. WPM is comparable across languages because it never rewards skipping a hard character. A "lenient" mode would be a new engine rule and a new validator rule, not a toggle.

## ADR-017: UI translations deferred to M6

- **Date:** 2026-09-16 · **Status:** accepted
- **Context:** The brief put interface translations (Hebrew/Arabic labels, `<html dir>` mirroring) in M3 alongside text-language support. M6 is a visual redesign that will rewrite most labels and layouts.
- **Decision:** M3 ships the *text* language (picker, `dir`/`lang` on the typing box, fonts) and defers the *interface* language to M6, so strings are translated once, after the final UI exists. What is already in place so the switch is mechanical: every component uses Tailwind logical properties (no `ml-`/`text-left`), `lang`/`dir` are set per element rather than assumed, fonts follow `:lang()`, and `i18next` + `react-i18next` are installed. The two settings stay independent: a Hebrew speaker can practise English typing in a Hebrew UI.
- **Consequences:** Until M6 the interface is English-only, which is visible to anyone reviewing the app before then. The `src/i18n/` folder holds only the language table for now; `en.json`/`he.json`/`ar.json` arrive with M6.

## ADR-018: Race architecture

- **Date:** 2026-09-16 · **Status:** accepted · full protocol in `docs/race-protocol.md`
- **Context:** M4 is the first milestone where state outlives a request. Rooms need to survive across API replicas, players refresh tabs mid-race, and placement must be as cheat-resistant as practice scoring.
- **Decision:**
  - **Redis is the room store and the event bus.** Room state lives in Redis hashes with TTLs (rooms clean themselves up); every server→client event is published on a per-room channel and every replica relays to its own sockets. Mutations that must not race (join, finish/place) are Lua scripts. Postgres only receives finished results.
  - **One WebSocket endpoint, auth in the first frame.** Browsers cannot send headers on WebSockets and query strings leak into logs, so the client sends `{"type":"auth","token":…}` first; anything else closes the socket.
  - **The server clock decides everything that affects fairness**: countdown start, race start, places (order of arrival of valid `finish` frames), timeouts. Client timestamps only animate.
  - **`progress` is advisory, `finish` is the whole keystroke log.** Races reuse `record_session(mode=RACE)` unchanged, plus the existing `server_duration_ms` check. An invalid log keeps its session row and gets no place.
  - **Disconnect keeps the slot during a race**; reconnect gets a full snapshot. Host handoff goes to the earliest-joined connected player.
  - Rooms are join-by-code only, max 5 players, no mid-race joining, no spectators (v1).
- **Consequences:** The WebSocket handler is thin: parse frame → Lua/Redis → publish. Two-replica correctness is designed in from the start even though Railway runs one replica today. Tests use two in-process WebSocket clients against a real Redis, no browser. The protocol document is the contract the frontend is built against; changing a frame means changing the doc in the same PR.

## ADR-019: Stats, leaderboards and a daily challenge without a scheduler

- **Date:** 2026-09-17 · **Status:** accepted
- **Context:** M5 needs personal stats, per-language leaderboards, and the brief's daily challenge, which it imagined as a cron job (arq) picking a text each midnight. A scheduler is another process to deploy, monitor and keep in sync across replicas, for a feature whose whole requirement is "everyone gets the same text today".
- **Decision:**
  - **Only valid sessions score.** Every read in `app/services/stats.py` filters `is_valid`; rejected logs stay in the table for inspection and never reach a number a user sees.
  - **Leaderboards rank each user's single best valid run** (`DISTINCT ON (user_id)`), per language, over a period of `day`, `week` (ISO, Monday) or `all`, in UTC. Practice and race runs both count; the top 50 are returned, and a logged-in viewer also gets their own row even when outside the top 50.
  - **The daily text is a pure function of the date:** `sha256("YYYY-MM-DD:lang") mod number_of_active_texts`, indexed over texts ordered by id. Every replica, every request, every player computes the same text with no shared state, no cron, no table. A daily run is a normal `POST /sessions` with `mode=daily`; the server refuses any text that is not today's. The daily leaderboard is the period-`day` board restricted to `mode=daily` and that text.
  - **Stats** per language: valid runs, best WPM, average WPM and accuracy over the most recent 20 runs (so old slow runs stop dragging the average), total time; plus the last 30 runs as a trend. **Per-key aggregates** (correct, errors, error rate, latency weighted by hits) for the heatmap.
  - History (`/me/sessions`) uses the same keyset cursor as every other list (ADR-011).
- **Consequences:** Adding or deactivating a text changes which text future days pick (the modulus changes); do it, but expect the daily text to change if it happens mid-day. The day boundary is UTC everywhere, so players in Israel get the new challenge at 02:00–03:00 local; a per-user timezone is a later refinement. No arq dependency. 9 tests cover the rules through the HTTP API, including invalid runs never scoring and the daily board ignoring practice runs on the same text.

## ADR-020: The keyboard heatmap

- **Date:** 2026-09-18 · **Status:** accepted
- **Context:** The brief promised a per-key heatmap on the three reference layouts (US QWERTY, Hebrew SI-1452, Arabic 101). `GET /me/keys` already returns per-character totals (ADR-019); the open questions were how to map characters to physical keys, and how to colour the result without lying.
- **Decision:**
  - **A key owns every character it produces**, so `a`/`A` are one cell and so are `ا`/`أ` (unshifted/shifted on the Arabic home row). The stats are keyed by character; the layout does the folding.
  - **Mappings we are not sure of are left out, not guessed.** Any character that has data and no key claims it is listed under the board ("not on this layout") instead of being silently dropped or attached to the wrong cell. A test asserts every Hebrew and Arabic letter has a home, so that row only ever holds punctuation we chose not to place.
  - **Colour is a sequential one-hue ramp over the error rate** (never missed → no fill; then four red steps). Dark mode is its own set of steps — the named dark reds are all vivid, so an inverted copy made a 96%-accurate board look on fire; a tint rising off the surface keeps "near zero" quiet in both modes.
  - **Colour is never the only channel**: every cell carries its character and a `title`/`aria-label` with the raw counts. "Not typed yet" is unfilled *and* dashed *and* muted, so it cannot be read as "clean".
  - The board defaults to the language with the most runs, not the last practised one — a heatmap of a language you have never typed is an empty board.
- **Consequences:** Adding a layout is a data change in `layouts.ts`, not a component change. The three boards were checked against realistic data in both colour schemes before shipping; the Arabic board correctly lights up ء ئ ؤ ة ى أ, which is where the strict letter matching of ADR-013 actually costs a typist.

## ADR-021: One definition per shared query

- **Date:** 2026-09-18 · **Status:** accepted
- **Context:** The daily challenge crashed the app. The home card and the practice page both cached `GET /daily` under the key `['daily', lang]`, but they disagreed about what was stored there: the card kept the whole `{ day, language, text }` envelope, the practice page kept only the inner text. A TanStack Query key is a cache address, so whichever page loaded first won — arriving at the practice page from the home card handed it the envelope, `text.data.content` was `undefined`, and rendering a text with no content threw. Opening `/practice?daily=1` directly was fine, which is why the unit test for daily mode stayed green while the deployed site broke.
- **Decision:**
  - **A query used by more than one component is defined once**, in `frontend/src/lib/queries.ts`, as a `queryOptions` object that owns both the key and the shape stored under it. Components import the definition instead of retyping the key. A component that wants part of the cached value uses `select`, which changes what that component sees and not what is cached.
  - **The cached value is the server's response, unmodified.** Reshaping inside `queryFn` is what let two pages store two different things at one address.
  - The daily definition is `staleTime: Infinity`: the text is fixed for the whole UTC day, and without it a window-focus refetch could swap the text out mid-run.
  - **A crash-level bug gets a test that fails on the old code.** The regression test walks the route the user walks — home page, click "Type today's text", type — because the bug only exists in the transition between two pages.
- **Consequences:** Cache keys stop being written by hand in components, so the next shared query cannot drift the same way. A second bug surfaced next to this one and is fixed here too: in daily mode "Next text" bumped the counter that belongs to the random-text key, so nothing refetched and the box was never cleared; with one fixed text for the day, the page now resets the engine itself.

## ADR-022: Rate limiting on the auth endpoints

- **Date:** 2026-09-18 · **Status:** accepted (supersedes the deferral in ADR-009)
- **Context:** ADR-009 put rate limiting in the M6 security pass, and the app went live before M6. `POST /auth/register`, `/auth/login` and `/auth/refresh` accept unlimited attempts: a script can guess passwords against a known email as fast as argon2 will answer, fill the users table, or grind the token endpoint. Redis is already a hard dependency (refresh token ids live there), so a limiter needs no new infrastructure.
- **Decision:**
  - **A fixed window counted in Redis**, one key per (bucket, identity), `INCR` plus an `EXPIRE` applied on the first hit **inside a Lua script**. Two separate calls can lose the expiry if the process dies between them, and a counter with no TTL is a permanent ban. A fixed window lets a caller spend one allowance at the end of a window and another at the start of the next; for a login form that is a fair trade against the cost of a sliding log.
  - **Limits are per identity, not global.** Register, login and refresh count per client address; login *additionally* counts **failures per email address**, which is the counter that actually stops password guessing — an attacker rotating addresses still walks into it. Defaults: 20 registrations, 40 login attempts and 120 refreshes per address per 15 minutes, and 10 failed logins per email per 15 minutes. All six are settings with those defaults, so a ceiling can be raised from the environment without a deploy.
  - **The email counter is read before the password is verified and only spent by a failure.** Reading first means a guessing run stops costing an argon2 verification once it is over the ceiling. Spending only on failure means a legitimate user who mistypes twice and then succeeds is not left half-locked-out; a success clears the counter outright.
  - **The client address is the last `X-Forwarded-For` hop**, falling back to the socket address. Each proxy appends the address it received the connection from, so with one trusted proxy in front (Railway's edge in prod, nginx in the compose stack) the last entry is the only one a client cannot write. Taking the first would let anyone spend someone else's allowance or dodge their own.
  - **The limiter fails open.** If Redis is unreachable it allows the request instead of raising. A Redis outage already breaks these endpoints on its own (refresh tokens are stored there); turning it additionally into "nobody can log in" would be a worse failure than the one being prevented.
  - **Refusals use the API's error shape** — `429` with `{"error": {"code": "rate_limited", ...}}` and a `Retry-After` header — so the frontend shows the message it already shows for every other failure, with no new branch.
- **Consequences:** An attacker can lock a known email out of logging in for up to 15 minutes by burning its failure counter; that is the accepted cost of the rule, bounded by the window and by the fact that the counter resets on any successful login before it is spent. Nothing here is a CAPTCHA or an IP ban, and nothing protects a distributed guessing run spread thinly across many addresses and emails — those belong to the M6 security pass along with lockout notifications. If the deployment turns out to present every request under one address, the per-address ceilings are the ones to raise; the per-email rule is unaffected by it. 14 tests cover the counter, the refusal shape, the window expiring, and the fail-open path.

## ADR-023: What the browser may keep, and for how long

- **Date:** 2026-09-18 · **Status:** accepted
- **Context:** Walking the M5 pages as a brand-new account, and as a second account on the same browser, turned up two faults of the same shape as ADR-021: state shared between call sites that each assumed it was alone. (1) Refreshing the access token **rotates** the refresh cookie (ADR-009), but nothing stopped two refreshes running at once — React's StrictMode bootstrap, two tabs waking together, or the three stats queries all retrying after a 15-minute access token expires. The first request spends the cookie, the second is rejected, and the loser's `setAccessToken(null)` logs out the session the winner just renewed. In dev this happened on **every page reload**. (2) TanStack Query keys like `['me','stats']` say *what* was asked for, not *who* asked, so after logging out and in as somebody else the new account was shown the previous account's numbers until their own request came back — measured at over a second on a throttled connection, and captured on screen.
- **Decision:**
  - **One refresh at a time.** `refreshAccessToken()` keeps the in-flight promise and hands the same one to every caller until it settles. A rotating credential can only be spent once, so it may only be asked for once.
  - **The query cache belongs to an identity.** When the signed-in user id changes to a different one, the whole cache is dropped. The first identity of a page load is not a change — there is nothing to drop and clearing then would throw away a warm cache. This is a rule about the cache's lifetime, not a per-key fix: a future `['me', …]` key inherits it without anyone remembering to.
  - **A failed query retries once, then says so.** The default of three retries leaves a page on "Loading…" for about seven seconds, which on this page is indistinguishable from an empty state. The stats page now renders the error for the per-key and history queries the way it already did for the rest.
- **Consequences:** Signing in as a second person costs a full refetch rather than showing stale rows — the right trade. A refresh that fails still logs the session out, as before; what changed is that a *successful* one can no longer be undone by a parallel loser. Two regression tests fail on the old code: three concurrent refreshes make one request, and the second account never sees the first one's numbers. What this does not address: nothing coordinates refreshes **between tabs** (each tab has its own in-flight promise), so two tabs whose tokens expire at the same moment can still race across a `BroadcastChannel`-shaped gap. That has not been observed and is left for the M6 pass.
