# Multilingual Typing Race

A TypeRacer-style typing trainer for **Hebrew, Arabic and English**: practice alone or race friends in real time, track WPM / accuracy / weak keys over time, leaderboards per language, daily challenge.

Typing trainers are built for Latin scripts, and the assumptions leak. Hebrew and Arabic arrive with vowel marks the keyboard cannot produce, with typographic punctuation that is not the punctuation on the key, and with letters that look the same to a reader and are different characters to a computer — ך and כ, أ and ا. Arabic letters change shape depending on their neighbours, so a renderer that draws one character at a time breaks the word. Every text here is normalized once at import so that what is displayed is exactly what a keyboard can produce, and the renderer keeps the shaping intact ([docs/rtl-notes.md](docs/rtl-notes.md)).

**The server is the judge.** The browser never sends a score. It sends the raw keystroke log — `[t_ms, expected, typed]` per key — and the server replays it, recomputes every number, and decides whether the run counts at all. A client that lies has to lie in a log that replays to the target text at a human rhythm.

**Live:** [web-production-1f908.up.railway.app](https://web-production-1f908.up.railway.app) · API health: [`/healthz`](https://api-production-57dab.up.railway.app/healthz)

> Status: **functionally complete (v1.0).** Next: visual pass. Working today: practice in Hebrew, Arabic or English; race up to four friends (five players to a room) in real time over WebSockets; a daily challenge that is the same text for everyone and changes at midnight Israel time; and per-language stats — speed, accuracy, history, a keyboard heatmap of the keys you miss, and daily / weekly / all-time leaderboards. Every run is scored and validated server-side from the raw keystroke log. The interface itself is English-only for now (ADR-017); see [Planned](#planned).

## How scoring works

The browser sends only the keystroke log — `[t_ms, expected, typed]` per key, `"\b"` for backspace — never a number. The server replays it and computes:

| metric   | formula                                        |
|----------|------------------------------------------------|
| WPM      | (correct characters ÷ 5) ÷ minutes             |
| raw WPM  | (all typed characters ÷ 5) ÷ minutes           |
| CPM      | correct characters ÷ minutes                   |
| accuracy | correct ÷ (correct + errors) × 100             |

The same formulas apply to all three languages. A session is stored as invalid — kept for inspection, excluded from stats and leaderboards — if the log is empty, if it holds fewer keystrokes than the text has characters, if replaying it doesn't reproduce the target text, if timestamps go backwards, if the median gap between keys is under 30 ms (checked once there are at least 20 gaps to take a median of), if 10 or more keys arrive ≤ 5 ms apart, or, in a race, if the client's duration disagrees with the server's clock by more than 1.5 s. A valid run above 250 WPM is kept and flagged for review rather than rejected. See `backend/app/services/validator.py`.

## Hebrew and Arabic

What you see is what you type: every text is normalized once at import (niqqud and tashkeel stripped, typographic punctuation mapped to the keys on the SI-1452 / Arabic 101 layouts, letters matched strictly — ך ≠ כ, أ ≠ ا) and the same string is displayed and validated. The typing box renders one span per character in all three languages; browsers keep Arabic letters joined across spans as long as the font is identical, which we measured before deciding not to build a second renderer. Details, rules and the reasoning: [docs/rtl-notes.md](docs/rtl-notes.md).

## What it looks like

A race recorded from the host's screen: two players, one Hebrew sentence, the text hidden until the countdown, both progress bars fed over one WebSocket each, and the places decided by the server from each player's keystroke log. **The typing is scripted**: a Playwright script drives two browser sessions, "Nell" and "Sami", at a fixed 75 ms and 105 ms per key — which is why the speeds (144.62 and 107.46 WPM) are faster than most people type. Everything else is the real stack: the server's countdown, the relay, the validator and the numbers it computed. A steady 75 ms rhythm is inside the human range, so the validator accepts it; it is built to reject pasted text and machine-speed input, not a script that types at a human pace (see [How scoring works](#how-scoring-works)).

![A two-player race in Hebrew: the lobby, the countdown revealing the sentence, both progress bars advancing as the text turns green right to left, and the server's results with places and WPM](docs/img/race-hebrew.gif)

Practising in Arabic, mid-run (typed by the same kind of script, with deliberate mistakes). Green is behind the caret, the pink cell is a character typed wrong — and the letters stay joined across it, because the renderer is one `<span>` per character and the shaping is the browser's job (ADR-014). Speed, accuracy and errors update as you type; the numbers that count are the server's.

![The practice page mid-run in Arabic: a partly typed sentence with one mistyped letter, and live WPM, accuracy and error counts underneath](docs/img/practice-arabic.png)

The stats page, filled by scripted practice runs: best and average per language, the last runs as a trend, and the keys you miss on the layout you actually type on — here Arabic 101. A key with no data is dashed rather than coloured, so "never typed" cannot be read as "never missed".

![The stats page: per-language cards, a WPM trend line, and an Arabic keyboard heatmap where missed keys are shaded red](docs/img/stats-heatmap.png)

## Accounts

Email and password (argon2), a short-lived access token held in memory and a rotating refresh token in an httpOnly cookie: using a refresh token spends it, so a stolen one stops working the moment the real user refreshes. Registration, login and refresh are rate-limited in Redis — per client address, plus a counter of failed logins per email address that any successful login clears. Ceilings are environment settings, not constants. See [ADR-009](docs/DECISIONS.md) and [ADR-022](docs/DECISIONS.md).

**Keystroke logs are kept.** Each run's raw log — the time and character of every key — is stored for as long as the run exists, so any score can be replayed and checked again later. It is never returned by the API; the run's numbers are ([ADR-029](docs/DECISIONS.md)).

## How it fits together

```mermaid
flowchart LR
    B["Browser<br/>React 19 · typing engine<br/>one span per character"]
    W["nginx<br/>static bundle"]
    A["FastAPI<br/>async SQLAlchemy<br/>scoring · validation"]
    A2["another API replica"]
    P[("PostgreSQL 16<br/>users · texts · sessions<br/>races · per-key stats")]
    R[("Redis 7<br/>refresh ids · room state<br/>rate limits · pub/sub")]

    B -- "page load" --> W
    B -- "HTTPS /api/v1" --> A
    B <-- "WebSocket /rooms/:code/ws" --> A
    A --> P
    A --> R
    A2 --> R
    R -. "pub/sub fan-out: any replica<br/>can serve any racer in a room" .-> A2
```

A race is not held in one process. Room state is a Redis hash with a TTL, every change that could race — joining the last seat, starting, each timed transition — is a Lua compare-and-set, and every frame is published to a channel. The countdown and the race deadline are stored in the room and applied by whichever server next looks at it, so a redeploy mid-race costs the players a reconnect, not the race, and the players in a room can be spread across replicas. Details in [docs/race-protocol.md](docs/race-protocol.md); the reasoning in ADR-018 and ADR-031, including what is still not covered.

```mermaid
sequenceDiagram
    participant C as Browser
    participant S as API
    participant V as validator
    C->>S: POST /sessions { text_id, started_at, keystrokes }
    S->>S: replay the log → does it reproduce the text?
    S->>V: median gap, machine-run, monotonic time, server clock
    V-->>S: valid / invalid + reason
    S->>S: recompute WPM, CPM, accuracy, per-key stats
    S-->>C: the server's numbers (the client's were display only)
```

## Stack

- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.0 (async) + asyncpg, Alembic, PostgreSQL 16, Redis 7
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, self-hosted Noto fonts
- **Infra:** Docker Compose (dev), GitHub Actions (CI), Railway (hosting)

## Run locally

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

- Frontend: http://localhost:5173
- API: http://localhost:8000 — health at `GET /healthz`, docs at `/docs`
- Seed the corpus once: `docker compose -f infra/docker-compose.yml exec api python -m app.cli seed-texts`

Backend checks (needs Python 3.13):

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
ruff format --check . && ruff check . && mypy . && python -m pytest -q
```

Frontend checks (needs Node 24):

```bash
cd frontend && npm install
npm run lint && npm run typecheck && npm test && npm run build
```

**209 backend tests** (pytest, against a real PostgreSQL and Redis), **86 frontend tests**
(Vitest + Testing Library) and a **3-case end-to-end smoke test** that boots the stack and
drives the built frontend with Playwright. All three run in CI on every pull request
([e2e/README.md](e2e/README.md)).

## Repo layout

```
backend/
  app/api/        HTTP routes (health, auth, texts, admin, sessions, stats, leaderboards + daily)
                  and the room WebSocket
  app/core/       settings, security, errors, dependencies, pagination
  app/i18n/       normalize.py — the he/ar/en normalization rules
  app/models/     SQLAlchemy models; alembic/ holds the migrations
  app/seeds/      the CC0 corpus: en.py, he.py, ar.py
  app/services/   users, texts, typing_metrics, validator, sessions, rooms (Redis + pub/sub), stats
  tests/          pytest, one file per module; runs against a real Postgres
frontend/
  src/features/typing-engine/   pure reducer + TypingBox renderer
  src/features/practice/        practice page, results card
  src/features/race/            room reducer, socket, lobby/race/results pages
  src/features/stats/           stats, leaderboards, keyboard heatmap + layouts
  src/features/auth/            auth store and forms
  src/i18n/                     language table (labels, direction)
  src/lib/                      api.ts (typed API client), queries.ts (shared query definitions)
  src/ui/                       shared pieces: header, wordmark, button, segmented toggle, stat strip (ADR-032)
infra/          docker-compose.yml
docs/           DECISIONS.md (ADRs), rtl-notes.md, race-protocol.md
.github/        CI workflow (backend + frontend jobs)
```

## Planned

Not built yet. Everything above this section describes what is in the repo today.

- **M6 — the visual pass.** The current interface is deliberately plain: correct behaviour, default styling. M6 is the design of every page, dark mode included.
- **Interface translations.** Hebrew and Arabic labels with a mirrored layout, deferred to M6 so the strings are translated once against the final UI (ADR-017). The text language and the interface language stay independent: a Hebrew speaker can practise English typing in a Hebrew interface.
- **Everything else that was considered and deliberately left out** — a background worker, OAuth, race replay, lenient Arabic matching, materialized views — is listed with its reasoning in ADR-027.

## Docs

- [Decision log](docs/DECISIONS.md) — every architectural choice, with its reasoning
- [RTL notes](docs/rtl-notes.md) — how Hebrew and Arabic are normalized, rendered and validated
- [Race protocol](docs/race-protocol.md) — rooms, WebSocket messages, timing, disconnects, scoring

## License

[MIT](LICENSE). The seed sentences are original and released under CC0.
