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

- **Date:** 2026-09-16 · **Status:** accepted · the "two-replica correctness" sentence in Consequences is superseded by ADR-031 · full protocol in `docs/race-protocol.md`
- **Context:** M4 is the first milestone where state outlives a request. Rooms need to survive across API replicas, players refresh tabs mid-race, and placement must be as cheat-resistant as practice scoring.
- **Decision:**
  - **Redis is the room store and the event bus.** Room state lives in Redis hashes with TTLs (rooms clean themselves up); every server→client event is published on a per-room channel and every replica relays to its own sockets. Mutations that must not race (join, finish/place) are Lua scripts. Postgres only receives finished results.
  - **One WebSocket endpoint, auth in the first frame.** Browsers cannot send headers on WebSockets and query strings leak into logs, so the client sends `{"type":"auth","token":…}` first; anything else closes the socket.
  - **The server clock decides everything that affects fairness**: countdown start, race start, places (order of arrival of valid `finish` frames), timeouts. Client timestamps only animate.
  - **`progress` is advisory, `finish` is the whole keystroke log.** Races reuse `record_session(mode=RACE)` unchanged, plus the existing `server_duration_ms` check. An invalid log keeps its session row and gets no place.
  - **Disconnect keeps the slot during a race**; reconnect gets a full snapshot. Host handoff goes to the earliest-joined connected player.
  - Rooms are join-by-code only, max 5 players, no mid-race joining, no spectators (v1).
- **Consequences:** The WebSocket handler is thin: parse frame → Lua/Redis → publish. ~~Two-replica correctness is designed in from the start even though Railway runs one replica today.~~ *(Superseded by ADR-031: the timed transitions were in-process timers, so this was not true until ADR-031.)* Tests use two in-process WebSocket clients against a real Redis, no browser. The protocol document is the contract the frontend is built against; changing a frame means changing the doc in the same PR.

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

## ADR-024: An end-to-end smoke test in CI

- **Context:** The two worst bugs so far — #29 and the refresh race in ADR-023 — both sat between the frontend and the backend, where every unit test on either side is green and the two still disagree. 186 backend tests and 65 frontend tests could not see either of them, because both sides were tested against their own idea of the other. Nothing in CI ever started the real stack and used it.
- **Date:** 2026-09-18 · **Status:** accepted
- **Decision:**
  - **One journey, through the built frontend against a real API**: register → practice run → the server scores it → the run appears on the leaderboard; plus the daily challenge opened from the home card, and a reload that has to keep you signed in. Nothing is stubbed, and the numbers asserted are the server's.
  - **Playwright lives in its own `e2e/` package**, not in `frontend/`. The frontend image runs `npm ci` with dev dependencies, so a browser download would land in the Railway build for no benefit.
  - **A third CI job**, with the same Postgres and Redis services the backend job uses. It builds the frontend, serves the bundle with `vite preview`, and runs the test against it; the Playwright trace and the API log are uploaded when it fails.
  - **The job raises the rate-limit ceilings rather than switching the limiter off** (ADR-022): every account it creates comes from the runner's one address, which is precisely what the per-address rule stops. Raised, not disabled, so the limiter stays in the path under test.
  - **Typing happens at 70 ms a key**, which keeps the run above the 30 ms median-gap floor and below the 250 WPM review threshold no matter how fast the runner is (ADR-015).
- **Consequences:** CI grows a job of about two minutes, mostly the browser download. A third check has to be added to whatever branch protection requires the other two. The test was confirmed to fail against the commit that had bug #29 and pass against its fix, so it is not decorative. What it does not cover: races (two refreshes at once need concurrency a linear script cannot force — `api.test.ts` covers that one), the WebSocket race flow, and anything about how the pages look. Those stay with the unit tests and with M6.

## ADR-025: A rank is a number the database computes; a rate needs a sample

- **Date:** 2026-09-28 · **Status:** accepted (refines ADR-019 and ADR-020)
- **Context:** Two faults in how M5 turns rows into numbers people read. (1) The leaderboard numbered rows by their position in the result list, so two players with identical WPM were shown as 2nd and 3rd — the board claimed a difference the data does not contain — and the number depended on how much of the board had been fetched. (2) The heatmap coloured a key from its error rate with no floor under the sample, so a key pressed twice and missed once rendered as 50% — the darkest cell on the board sitting on the key you have pressed least.
- **Decision:**
  - **The rank comes from the database**, as `rank() over (order by wpm desc)` on the per-user best runs, not from the row's index. Equal WPM means equal rank, and a player's rank is the same whether they are read out of the top 50 or looked up alone.
  - **Standard competition ranking everywhere except the daily board**: a tie consumes the numbers behind it (1, 2, 2, 4), which is what a league table means. The daily board is one text on one day, where ties are common and a gap after each one reads as a missing player, so it alone uses `dense_rank()` (1, 2, 2, 3). The mode is a parameter, not two code paths.
  - **A key is coloured only from ten keystrokes up.** Below that it is drawn like a key never pressed — dashed, unfilled — with a tooltip that says how few there are. Both states mean "we don't know yet", which is exactly what ADR-020 asks a cell to never confuse with "clean".
  - **The floor is applied where keys are assembled, not in SQL.** The query returns one row per *character*, but a key owns several of them (`a`/`A`, `ا`/`أ`), so a `HAVING` clause would discard a character with six hits whose key has thirty. The meaningful sample is the key's, and the renderer is where a key exists.
- **Consequences:** Ranks are stable and honest about ties, at the cost of a window function over the per-user bests — irrelevant at this scale, and the index on `(language, is_valid, wpm)` still serves the scan. A player tied for first now sees "1" rather than "2", which is a visible change to anyone who looked yesterday. Ten is a judgement, not a measurement: it is low enough that a single 150-character run fills most of the board and high enough that a stray keystroke cannot dominate it. Six tests cover ties, the rank of a player outside the top 50, dense numbering on the daily board, and both sides of the sample floor.

## ADR-026: The security pass — limits on writes, headers on everything

- **Date:** 2026-09-28 · **Status:** accepted (extends ADR-022)
- **Context:** ADR-022 put ceilings on the three auth endpoints and left everything else open. The two endpoints that do real work per call were still unbounded: `POST /sessions` replays an entire keystroke log and writes a row plus its per-key stats, and `POST /rooms` creates a Redis key with a TTL and a pub/sub channel. Both need a token, so anyone abusing them is doing it as a named account. Separately, the API sent no security headers at all.
- **Decision:**
  - **Write ceilings are counted per account, not per address.** These endpoints are authenticated, so the account is the thing worth limiting, and counting by address would put a whole university behind one allowance. 60 submitted runs and 20 rooms per 15 minutes: a person practising hard does perhaps 20 runs in that window.
  - **The refusal lives in one place.** `core/limits.py` now owns `enforce()` and `refuse()`; the auth routes use it instead of their own copies, so every limited endpoint returns the same 429 with the same `Retry-After`.
  - **Headers on every response**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that turns off sensors this API will never need. They are set with `setdefault`, so a header a route chose — `Retry-After` — is never overwritten.
  - **HSTS in production only.** Sending it from a local http server would pin a developer's browser to `https://localhost` for a year.
  - **No Content-Security-Policy on the API.** A CSP protects the origin that serves *pages*; this one serves JSON, and the only document it returns is the Swagger UI at `/docs`, which loads its assets from a CDN. The CSP that matters belongs in the nginx config in front of the built frontend — deliberately **not** done here: it cannot be exercised by the test suite or by CI, and shipping an untested `Content-Security-Policy` to the live site two days before a deadline risks a white page for a header nobody is currently attacking.
- **Consequences:** A client that hits a write ceiling gets the same 429 shape it already handles, so the frontend needed no change. The limiter still fails open when Redis is unreachable (ADR-022), which now also means an unbounded submit endpoint during a Redis outage — acceptable, since scoring needs the database and the run is still validated. What is left for the M6 security pass proper: the frontend CSP, a dependency audit, and the distributed-guessing gaps ADR-022 already lists. 7 tests cover the headers, HSTS's two modes, the two write ceilings, and that one account's ceiling does not touch another's.

## ADR-027: What was left out, and the one comment that claimed otherwise

- **Date:** 2026-09-28 · **Status:** accepted
- **Context:** Several things in the original brief were never built, each for a reason that lives in a commit message or in someone's head rather than in this file. A reader — including the author in six months — cannot tell "not built" from "forgotten". One of them is worse than an omission: `models/session.py` described the `keystrokes` column as *"pruned to NULL after 30 days by a cron job (M5)"*, and no such job exists anywhere in the backend. That is a false claim about what happens to the most personal data the app stores.
- **Decision:** the following are deliberately **not** in v1.0, and the README says so rather than implying otherwise:
  - **No background worker (`arq`) and no cron jobs.** ADR-019 removed the only feature that wanted one by making the daily text a pure function of the date. ADR-002 still lists `arq` in the stack; it was never added, and this entry supersedes that line.
  - **Keystroke logs are kept.** Raw logs are what makes a run re-verifiable, and they are also the most personal thing here. Deleting them on a schedule would need the scheduler ADR-019 avoided, so the choice is deferred rather than half-made — and **the comment that claimed a pruning job exists is corrected in this commit**. Whichever way it goes, it needs its own ADR and a retention line in the README.
  - **No interface translations** (ADR-017), **no OAuth**, **no race replay**, **no lenient Arabic matching** (ADR-013 chose strict letter matching on purpose), **no materialized views** — plain queries are well inside their budget at this scale, and a view would be a second thing to keep correct.
  - **Recharts is not used.** ADR-002 lists it; the one chart is thirty points and a line, drawn as inline SVG. Supersedes that line too.
- **Consequences:** ADR-002's stack list is now wrong in two places on purpose, which is what superseding means here — it is the record of what was decided in M0, not a description of today. A reviewer asking "why is there no worker?" has an answer. The retention question is the one item on this list that is a genuine open decision rather than a closed one, and it is the first thing to settle if this app ever has users who are not friends.

## ADR-028: Five players to a room

- **Date:** 2026-09-28 · **Status:** accepted (gives the reasoning for one line of ADR-018)
- **Context:** The brief asked for rooms of 2–10 players. ADR-018 shipped a cap of five (`MAX_PLAYERS = 5` in `services/rooms.py`) and stated it without saying why, which a review correctly flagged.
- **Decision:** five, for two reasons that both get worse with every seat added.
  - **Fan-out grows with the square of the room.** Each player sends a progress frame at most every 250 ms (the server drops anything closer than 200 ms), and every frame is published to every player in the room. That is roughly 4 × n² deliveries a second per room: 100 at five players, 400 at ten. Redis pub/sub carries that easily for one room; the point is that the cost of a room is not linear in its size, and five keeps a busy evening of rooms cheap.
  - **The race screen is one row per player above the text.** Every extra row pushes the sentence further down, and a player cannot scroll while typing. Five rows leave the text where the eye already is.
  - The use case is friends racing by a shared code, which two to five covers.
- **Consequences:** Raising the cap is two constants and a layout check on a phone, not a redesign. The protocol, the Lua join script and the results code all read `MAX_PLAYERS`; the one other place the number lives is the `/5 players` label in `RoomPage.tsx`, which is hard-coded and has to change with it. A sixth player gets the existing `room_full` error, which the client already shows.

## ADR-029: Keystroke logs are kept

- **Date:** 2026-09-28 · **Status:** accepted (settles the open item in ADR-027)
- **Context:** Every run stores its raw keystroke log, `[t_ms, expected, typed]` per key. The server scores from it, and it is also the most personal thing the app holds: a timing trace of how one person types. ADR-027 corrected a comment that claimed a pruning job existed and left retention as an open decision. The options were to keep logs, to delete them after a fixed window (30 days was built and tested as a command), or never to store them.
- **Decision:** keep them, for as long as the run itself exists.
  - **A score can always be checked again.** The point of storing the log is that the server's verdict is reproducible: a run that looks wrong — flagged above 250 WPM, or questioned on a leaderboard — can be replayed from what the player actually sent, whenever the question comes up. A retention window puts an expiry date on that.
  - **No scheduler is needed.** Deleting on a schedule is either a worker process, which ADR-019 and ADR-027 keep out, or a command someone has to remember to run, which is a policy that holds only as well as someone's memory.
  - **The log is never exposed.** No endpoint returns it; the API sends back only the numbers computed from it (`test_honest_practice_session_is_stored_and_scored` asserts this).
- **Consequences:** The README states the policy instead of listing retention as undecided. Storage grows with every run — a few kilobytes of JSON each, which is nothing at this scale and a question for later at a much larger one. Deleting an account's logs on request is not built; if the app ever has users who are not friends, that is the first thing this decision owes them, and it is a `DELETE` or an `UPDATE … SET keystrokes = NULL` away, not a redesign.

## ADR-030: The app's day starts at midnight in Israel

- **Date:** 2026-09-28 · **Status:** accepted (supersedes the UTC day boundary in ADR-019)
- **Context:** ADR-019 put every day boundary in UTC: the daily challenge changed, and the "day" and "week" leaderboards reset, at midnight UTC — 03:00 in Israel in summer and 02:00 in winter. The original brief asked for Asia/Jerusalem, and the players this app is for are there. A challenge that changes in the middle of the night, and a "today" board that still shows yesterday's runs until 3 am, is the wrong calendar for them.
- **Decision:** one calendar for the whole app, `APP_TZ = ZoneInfo("Asia/Jerusalem")` in `services/stats.py`.
  - **The daily challenge is picked by the Israeli date.** `today()` converts the current instant to `APP_TZ` before taking the date, so the text turns over at local midnight. The pick itself is unchanged — still a hash of the date and language, the same on every replica with no shared state (ADR-019).
  - **The "day" and "week" boards start at local midnight** (the week on Monday, as before). Keeping them on UTC while the challenge moved would put the daily board's window three hours away from its own text.
  - **A named zone, not an offset.** `ZoneInfo` follows daylight saving, so the boundary is local midnight all year; a fixed `+02:00` would be an hour off every summer. Israel changes the clocks at 02:00, so local midnight always exists exactly once.
  - **`tzdata` is a dependency.** `zoneinfo` reads the operating system's zone files first and falls back to the `tzdata` package; slim container images do not always ship the files, and a missing zone would fail at import rather than quietly fall back to UTC.
- **Consequences:** Every player sees the same day, whatever their device's time zone — the product is for Israel, and a per-user calendar would give two friends a different "today's text". Timestamps in the database and the API stay in UTC; only the boundaries moved. A daily run started before midnight and submitted after it is refused as "not today's text", exactly as it was at midnight UTC. 3 tests pin the boundary in summer, in winter, on the day the clocks change, and the Monday start of the week.

## ADR-031: Race state survives restarts, double starts and second tabs

- **Date:** 2026-09-28 · **Status:** accepted (supersedes the "two-replica correctness" sentence in ADR-018)
- **Context:** An external review of the race subsystem found that ADR-018 claimed more than the code did. ADR-018 says *"two-replica correctness is designed in from the start"*; it was not. Each finding was reproduced before anything was fixed — the new tests were run against the old code, and failed:
  - **Timed transitions lived in one process.** `countdown → running`, the race deadline and the lobby grace period were `asyncio` tasks on whichever replica handled the triggering frame. With one replica — today — any restart during a countdown or a race left the room stuck until its Redis TTL, with a `races` row that never got results; Railway redeploys on every push to `main`. Reproduced with two real browsers: killing and restarting the API during the countdown left both players looking at a locked input forever.
  - **`start` was check-then-act with an `await` in between.** It read the room, checked `lobby`, queried Postgres for a text, then wrote `countdown`. Two `start`s at once (the host in two tabs) both passed the check: two `countdown` events with two different texts, and whoever rendered the first one finished with a log that no longer replays to the stored text, so the validator rejected an honest run as `text_mismatch`. Reproduced: two countdowns.
  - **Presence was per user, not per socket.** A second tab for the same account "reconnected" the player; closing the first tab then marked them disconnected while the second was open, and in the lobby they were removed after the grace period. Reproduced: the host was removed from their own room.
  - **`progress` was not bounded.** A client could send `typed: 100000` and show a full bar to everyone else. Reproduced.
  - **Player writes were read-modify-write on one JSON blob**, so a progress update and a disconnect landing together could lose the `connected` flag.
- **Decision:**
  - **Timed transitions are lazy.** The deadline is stored in the room (`starts_at_ms`, `deadline_ms`), and `RoomService.tick(code)` performs whatever is due. Every transition is a compare-and-set in Lua — exactly one caller moves the room and publishes the event, on any replica. `tick` runs on every incoming frame, every join, every room preview, and about once a second in each socket's relay loop. The in-process timers are kept, and demoted: they only make a transition land on time rather than up to a tick late.
  - **The `races` row is written idempotently** (`INSERT … ON CONFLICT DO NOTHING` on a race id chosen by whoever wins the transition), and again before anything references it, so a replica dying between the Redis write and the Postgres write leaves nothing dangling. Results are inserted the same way.
  - **`start` and `play_again` are compare-and-sets.** The text is chosen first; the `lobby → countdown` check and write are one script. The early checks remain only to give a clear error.
  - **Presence is per connection.** Each socket gets an id; the player stores the id of their newest socket; a disconnect only counts if it comes from that socket (checked and written in Lua). The lobby grace period is a timestamp on the player, swept by `tick`, not a sleeping task.
  - **Player fields are merged in Lua**, never rewritten whole from a stale read.
  - **`progress` is clamped**: `typed` to the text length, `errors` to `typed`.
  - Smaller: the socket's cleanup no longer lets a Redis error escape the handler; connection bookkeeping is never sent to clients.
- **Consequences:** A redeploy during a race now costs the players a reconnect — the frontend already does that on its own — and the race carries on: the same two-browser test that hung before now finishes with both players placed. What is still true, and stated rather than hidden:
  - **A room only moves while someone is connected to it, or while the replica that armed its timer is alive.** If the process restarts and nobody comes back, nothing ticks: the room expires with its TTL and that race's `races` row keeps `finished_at` empty. Every run that was submitted is already stored and scored in `typing_sessions`; what is lost is the results table for a race nobody returned to.
  - **A replica dying between the `finished` compare-and-set and the results insert** loses that race's `race_results` rows, for the same reason and with the same limit on the damage.
  - **Deadlines are compared against each replica's own clock**, so clock skew between replicas shifts a transition by the skew. With one replica there is none.
  - **The WebSocket authenticates once** (race-protocol §3): an open socket outlives token expiry and logout. Acceptable for a room capped at minutes; noted, not fixed.
  - Each connected socket costs one small Redis read a second for its ticks — five a second for a full room.
  - 11 tests: four over WebSockets (two `start`s at once make one countdown; closing an old tab leaves the new one connected; `progress` is clamped; a race starts and ends with every in-process timer disabled) and seven at the service level (a second service instance carries a room through countdown and deadline after the first one's timers are gone; a tick before the deadline changes nothing; five concurrent ticks make one transition and one `races` row; two concurrent starts make one countdown whose text is the stored one; `play_again` twice resets once; a disconnect from an old connection is ignored; connection ids are not in snapshots).

## ADR-032: Keyrace, and the design tokens for M6

- **Date:** 2026-09-28 · **Status:** accepted · the visual pass (M6), step 1 of 6
- **Context:** Until now the interface was deliberately plain (ADR-017 deferred design to M6): default Tailwind greys and blues, each page with its own ad-hoc links to the others, and "Multilingual Typing Race" in the tab — a description of the repo, not a product name. M6 restyles every page, one page area per PR. Doing that without an agreed palette, type scale and spacing would produce six PRs with six slightly different looks. A proposal (palette, type scale, spacing, components, three names) was reviewed and approved before any page was touched.
- **Decision:**
  - **The product is called Keyrace.** It says what the app does in plain English. The three scripts, which the name does not carry, are said next to it on the home page ("Type in English · עברית · العربية", step 3). The repository stays `multilingual-typing-race`, because the README, CV and existing links point to it; only the UI, page titles, favicon and README title use the product name.
  - **Colours are CSS variables with a light and a dark value**, exposed to Tailwind through `@theme inline` in `index.css`: `paper`, `surface`, `ink`, `muted`, `line`, `accent` (+ `accent-soft`), `ok`, `err` (+ `err-soft`). Components use `bg-surface`, `text-muted`, `border-line` and so on, and need no `dark:` variant for these. Cool neutrals with a slight blue bias; one blue accent for actions, the caret and focus. **Green and red mean only right and wrong characters**, and a wrong character is marked by background *and* colour, never colour alone, so it survives red–green colour blindness. The heatmap keeps its own red ramp (ADR-025).
  - **Contrast, measured** (WCAG ratio, text on `surface`): light — ink 17.8, muted 6.2, ok 5.0, err 5.4, accent 5.8; dark — ink 14.4, muted 6.7, ok 7.9, err 6.4, accent 6.5. Every text colour clears 4.5:1 in both themes; `err` on `err-soft` is 4.6 (light) and 5.6 (dark).
  - **Type stays on the three Noto families** already self-hosted. Typing text has its own tokens, phone-first: 24px English/Hebrew and 28px Arabic below 640px, 30px and 36px from there (`--text-typing`, `--text-typing-ar`, `-lg`). Arabic is one step larger because Naskh reads small at equal size. ADR-014's rules for the typing box are unchanged: identical font properties on every character span, no letter-spacing, no inline-block per character.
  - **Shape and space:** Tailwind's 4px spacing steps; 8px corners on controls, 12px on cards; every tap target at least 40px tall; one centred content column, 960px wide (`max-w-page`).
  - **One header on every signed-in page** — the Keyrace wordmark (home link), Practice · Race · Daily · Stats · Leaderboard with the current page marked, and the user's initial opening a menu with their name and Log out. It replaces the per-page Home / Stats / Leaderboard links. On a phone the nav takes its own row and fits at 360px and wider; at 320px it scrolls inside itself, never the page. Log in and register get the wordmark only.
- **Consequences:** Each remaining M6 step restyles a page area with these tokens and nothing else: typing screen, home, race, stats and leaderboard, then new README media. A page not yet restyled sits inside the new header and background with its old controls, which is the expected state between steps. Changing a colour later is one line per theme in `index.css`. 3 tests cover the header: the five links and the current-page mark (including Practice versus Daily, which share a path), the wordmark linking home, the page title, and the account menu opening, closing on Escape, and logging out.

## ADR-033: Race results carry each run's time and, if refused, why

- **Date:** 2026-09-29 · **Status:** accepted
- **Context:** The results table showed a time and a reason for your own run only. `player_finished` and `race_over` carried `wpm`, `accuracy` and `valid` but no duration and no reason, so the frontend (M6 step 4) filled the gaps itself: your own time and reason came from a second request to `/me/sessions`, and everyone else's time was estimated from when their `player_finished` reached your browser, marked "≈". Two players looking at the same race could see different times for the same run, and nobody could see why someone else's run was not counted. The server already had both numbers when it scored the run.
- **Decision:**
  - `player_finished` and every row of `race_over.results` gain **`duration_ms`** and **`reason`**. `duration_ms` is the run's recorded duration — the same number WPM is computed from, measured from the server's `started` (race-protocol §5). For a counted run it agrees with the server's own clock within 1.5 s; for a refused run it is what the log claimed, and `reason` says why it was refused. `reason` is the validator's code (`median_gap_too_low`, `duration_disagrees_with_server`, …) when the run was refused, and `null` otherwise — including for a run that was flagged for review but counted, since it did count. A player who did not finish has both `null`.
  - The change is **additive**. The protocol has no version number to bump: the compatibility rule is §3's — clients ignore what they do not know — and that rule now covers unknown fields as well as unknown frame types. It is stated in a new §10 of race-protocol.md.
  - The frontend drops the `/me/sessions` lookup and the "≈" estimate and shows the server's time and reason for every player.
- **Consequences:** Everyone in a room sees the same time for the same run, and a refused run explains itself to the whole room, not just to its owner. The reason codes become part of what other players see; they describe the log (keys too evenly spaced, time disagreeing with the server), not the person, and the wording on screen is the same plain sentence the practice screen uses. Snapshots (`room`) carry both fields on each player too, so a reconnect mid-results shows the same table. 2 tests: the WebSocket test for a pasted log asserts both fields on `player_finished` and `race_over`, for the refused run and the honest one; the frontend results test shows another player's refusal reason and exact time.

## ADR-034: Guest practice — scored by the server, stored nowhere

- **Date:** 2026-09-29 · **Status:** accepted · v1.1
- **Context:** Someone opening the live link alone, typically a recruiter with a minute to spare, met a landing page whose only ways forward were "Create account" and "Log in". Nothing could be typed without handing over an email address first. The app's central claim, that the server replays the log and decides, could not be seen without committing to it.
- **Decision:**
  - **`/try`** is a public page: the practice page in guest mode, one click from the landing page's "Try it now". Same texts, languages, difficulties and typing engine. A banner says "Guest run — not saved. Create an account to keep your stats." A signed-in player who opens `/try` is sent to `/practice`, where their runs are kept.
  - **`POST /api/v1/sessions/guest`** takes the same log as `POST /sessions` (no `mode`) and runs it through the same code: `score_run()` now holds the replay, the metrics and the validator, and both endpoints call it. The guest endpoint returns the verdict and the numbers with `saved: false` and no id.
  - **Nothing is written.** No `typing_sessions` row, no `session_key_stats`, no keystroke log. Reasons: a guest has no identity to attach a run to, so a stored run could never be shown to them again, only counted in aggregates nobody asked to join; the leaderboards mean "runs by accounts", and an anonymous row would let one person fill a board from many browsers; and ADR-029 keeps every stored log for as long as its run exists, a commitment that should not be made to someone who never agreed to anything. Not storing is the simplest way to keep all three.
  - **What a guest can and cannot do.** Can: practise any language and difficulty, get the server's WPM, accuracy, errors, time, most-missed keys and the validator's verdict with its reason. Cannot: see stats or history, appear on a leaderboard, race, take the daily challenge, or read the daily board — those routes still require an account on both the client and the API. `/try?daily=1` is ignored rather than honoured.
  - **Limited per address**, 30 runs per 15 minutes (`rate_limit_guest_sessions_per_ip`): there is no account to count against, and a guest run still costs a full replay. Same 429 and `Retry-After` as every other limit (ADR-022).
- **Consequences:** A visitor can type in any of the three languages within one click and see the server's verdict. Guest runs leave no trace, so there is also no record of how many visitors tried it; that is accepted, not overlooked. A guest who likes their run cannot claim it after registering, because it was never kept. The per-address ceiling is shared by everyone behind one NAT, which at 30 runs per 15 minutes is far above one person and still a stop for a script. 15 tests: six on the API (a guest run returns the verdict and writes no rows and nothing on the board; a pasted log is refused by the same validator and not kept; a signed-in caller on the guest endpoint is not saved either; malformed, future and unknown-text runs are refused; the per-address limit applies; account endpoints still refuse without a token) eight in the browser (the landing button opens guest mode with the banner; a guest run goes to the guest endpoint with no token and says it was not saved; stats, race, leaderboard and the daily each redirect to log in, four cases; `/try?daily=1` stays free practice; a signed-in player on `/try` is sent to `/practice`), and one end to end in CI: landing page → Try it now → an Arabic run scored by the real server, `saved: false`, no token sent, and `/stats` still asks to log in.

## ADR-035: Racing alone — a pacer, and today's #1 as a ghost

- **Date:** 2026-09-29 · **Status:** accepted · v1.1
- **Context:** A race needs a second person. A visitor who comes alone, which is most of them, never sees the part of the app that races; ADR-034 let them type, not race.
- **Decision:**
  - **A pacer on free practice**, for guests and accounts: Off / 40 / 60 / 80 WPM. A second row, drawn like a race row, fills at `wpm × 5` characters a minute from your first key and stops at the end of the text. It is computed in the browser from the same clock as the live stats, and never sent anywhere; it does not touch scoring.
  - **Today's #1 as a ghost on the daily**, for accounts, once the daily board has a #1. "Race today's #1" draws their run as a second row, character by character as it happened. `GET /api/v1/daily/ghost?lang=` picks the same run the board shows first (fastest valid daily run on today's text, earliest on ties) and returns its public display name, its WPM, and `offsets_ms`: for each character of the text, the time in ms from the run's first key at which it was typed for the last time. The browser's bar is the count of those times that have passed.
  - **Privacy.** ADR-029 keeps every run's raw log and promised it is never returned by the API; this endpoint keeps that promise. What leaves the server is derived from the log, not the log: no typed characters, so no wrong keys and nothing a player typed by mistake; no backspaces or correction pattern, since a wrong key and its correction cancel out in the replay and only the time the right character landed remains; no session id, user id or email. The name and the speed are already public on the daily board, and the text is public. What is new is the rhythm of the winning run, which is exactly what racing it means. It is only the day's #1, only while the day lasts, and only to signed-in players, like the daily itself.
- **Consequences:** Someone alone can race a steady target on any practice text, and a signed-in player can race the best run of the day. A ghost needs a stored log, so a run from before logs were kept could not be one; since ADR-029 every run has one. If the #1's run is later removed, the next run becomes the ghost with no special handling. The pacer and the ghost start on your first key rather than on a countdown, so reaction time is not part of the comparison, unlike a race (race-protocol §5). 12 tests: five on the API (per-character times from a log with a correction; no ghost before a counted run; the ghost is the board's #1, a refused faster run never is, and the payload is exactly day, language, text id, name, WPM and times; a correction replays as it happened; signed-in only) and seven in the browser (the pacer's rate at 40, 60 and 80 WPM and that it is steady; it waits for the first key and stops at the end; the ghost matches the run fed through the real typing engine key by key, wrong letter included; the ghost counts between keys; the pacer control and row on free practice; "Race today's #1" and the ghost row on the daily; the no-#1-yet message).
