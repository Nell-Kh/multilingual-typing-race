# Race protocol

How a multiplayer race works, end to end: rooms, the WebSocket messages, timing,
disconnects, and how results are scored. Written before the handler (ADR-018),
the same way `rtl-notes.md` preceded the renderer. If the code and this document
disagree, one of them is wrong — fix it and update the other.

## 1. Vocabulary

- **Room** — a lobby identified by a 6-character **code** (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`,
  no `0/O/1/I`). Has a host, a language, a difficulty, up to **5 players**.
- **Race** — one run of one text inside a room. A room runs one race and then can
  run another ("play again") with a new text.
- **Player** — an authenticated user connected to the room over a WebSocket.
- **Host** — the player who created the room; the only one who can start a race.

## 2. Room lifecycle

```
          create           host: start          all finished / timeout
 (none) ───────► lobby ────────────► countdown ──► running ──────────────► finished
                   ▲                  (3 s)                                    │
                   └──────────────────── host: play again ─────────────────────┘
```

| State | What players see | Leaves the state when |
|---|---|---|
| `lobby` | player list, "waiting for host" | host sends `start` (≥ 1 player connected) |
| `countdown` | the text (input disabled), 3-2-1 | `starts_at` passes (server timer) |
| `running` | typing box + everyone's progress bars | every connected player finished, or 60 s after the first finish, or 5 min after start |
| `finished` | results table, "play again" | host sends `play_again` → `lobby`, or the room expires |

Expiry: a room is deleted 10 minutes after its last message in `lobby`/`finished`,
and 5 minutes after `start` in `running` (nobody types one text for 5 minutes).
Redis TTLs enforce this; nothing else has to clean up.

## 3. Transport and auth

- One endpoint: `GET /api/v1/rooms/{code}/ws` → WebSocket.
- Browsers cannot set headers on a WebSocket, and query strings end up in logs, so
  the **first frame the client sends is `auth`** with the access token. Anything
  else first, or nothing within 5 seconds, closes the socket with code `4401`.
- After `auth` the server replies with a full `room` snapshot. Every later change
  is pushed as an event; the client never polls.
- All frames are JSON objects with a `type` field. Unknown types are ignored
  (forward compatibility); malformed JSON closes the socket with `4400`.

Rooms are created over plain HTTP so the client has a code to connect to:

| HTTP | Purpose |
|---|---|
| `POST /api/v1/rooms` `{language, difficulty}` → `201 {code}` | create; caller becomes host |
| `GET /api/v1/rooms/{code}` → `200 {code, state, language, difficulty, players: [...]}` | preview before joining; `404` if unknown/expired |

## 4. Messages

### Client → server

| type | payload | when allowed |
|---|---|---|
| `auth` | `{token}` | first frame only |
| `start` | – | host, in `lobby` |
| `progress` | `{typed: int, errors: int}` | `running`; at most one per 200 ms (extra ones are dropped, not punished) |
| `finish` | `{started_at: iso, keystrokes: [[t, expected, typed], ...]}` | `running`, once per player |
| `play_again` | – | host, in `finished` |
| `leave` | – | any state; same as closing the socket |

### Server → client

| type | payload | sent |
|---|---|---|
| `room` | full snapshot: `{code, state, language, difficulty, host_id, text?, starts_at?, players: [{id, display_name, connected, typed, errors, finished_at?, result?}]}` | after `auth`, and after every reconnect |
| `player_joined` / `player_left` | `{player}` / `{player_id}` | lobby changes |
| `player_connection` | `{player_id, connected}` | a socket drops or comes back mid-race |
| `host_changed` | `{host_id}` | host handoff (§6) |
| `countdown` | `{text: {id, content, char_count}, starts_at: iso}` | host pressed start |
| `started` | `{started_at: iso}` | `starts_at` passed; input unlocks |
| `progress` | `{player_id, typed, errors}` | relayed to everyone else, throttled to 5/s per player |
| `player_finished` | `{player_id, place, wpm, accuracy, valid}` | a `finish` was scored |
| `race_over` | `{results: [{player_id, place, wpm, accuracy, valid, dnf}]}` | the race ended (§5) |
| `error` | `{code, message}` | e.g. `not_host`, `room_full`, `wrong_state`, `already_finished` |

`place` is assigned in the order valid `finish` frames **arrive at the server**,
never from client timestamps.

## 5. Timing and scoring

- The **server clock is authoritative**. `countdown.starts_at` is server time; the
  client shows 3-2-1 against it and unlocks the input on `started`, which the
  server sends when its own timer fires. Client clock skew changes the animation,
  not fairness.
- `finish` carries the full keystroke log — the same format as practice — and goes
  through `record_session(mode=RACE)`: same metrics, same validator
  (`docs/DECISIONS.md` ADR-012, ADR-015). The validator additionally gets
  `server_duration_ms` = time between the server sending `started` and receiving
  `finish`; a client-reported duration that disagrees by more than 1.5 s is
  rejected (`duration_disagrees_with_server`, already implemented).
- An invalid log keeps its `typing_sessions` row (`is_valid=false`), gets no place,
  and shows as "not counted" in the results. Places are only given to valid runs.
- `progress` frames are **advisory**: they drive the other players' progress bars
  and nothing else. Nobody can win by sending `progress` — only a validated
  `finish` counts.
- The race ends when every *connected* player has finished, or 60 s after the
  first valid finish, or 5 min after start. Players who did not finish are `dnf`.

## 6. Disconnects and the host

- Dropping the socket does **not** remove a player during `countdown`/`running`:
  they are marked `connected=false` and keep their slot for the rest of the race.
  Reconnecting (same user, `auth` again) restores them and re-sends `room`, so a
  refreshed tab lands back in the race with the text and everyone's progress.
- In `lobby` and `finished`, dropping the socket removes the player after a
  10-second grace period (covers a page refresh without leaving ghosts).
- **Host handoff**: if the host leaves (or stays disconnected past the grace
  period in `lobby`/`finished`), the earliest-joined connected player becomes host
  and everyone gets `host_changed`. If nobody is left, the room expires.
- A race in `running` never waits for a disconnected player beyond the 60 s /
  5 min rules above.

## 7. Storage

Redis holds live state; Postgres holds results.

```
room:{code}            HASH  state, host_id, language, difficulty, text_id, starts_at, started_at, created_at
room:{code}:players    HASH  player_id -> JSON {display_name, joined_at, connected, typed, errors, finished_at, session_id, place}
room:{code}:events     PUB/SUB channel: every server→client event is published here
```

Every API replica subscribes to the channel of each room it has sockets for and
relays. With one replica this is a loop-back; with two it is what makes races
work at all. Room mutations go through small Lua scripts (join, finish) so two
replicas cannot both admit a sixth player or assign the same place twice.

Postgres (migration `0003`):

```
races          id, code, language, difficulty, text_id, started_at, finished_at
race_results   race_id, user_id, session_id (→ typing_sessions), place NULL for dnf/invalid
```

`typing_sessions.mode = 'race'` rows are what leaderboards and stats read; the
`races` tables exist so a result page can show who you raced against.

## 8. What is deliberately out of scope for v1

- Spectators, public room lists, matchmaking — rooms are join-by-code only.
- Mid-race joining. The player list is frozen at `countdown`.
- Rematch with the same text. `play_again` always draws a new text.
- Bots to fill empty rooms.

## 9. Test plan

Backend, no browser: two `httpx`/`starlette` WebSocket test clients in one room.
Cases: auth required; host-only start; countdown → started ordering; progress
relay; finish order gives places; invalid log gets no place; disconnect during
race keeps the slot and reconnect gets a snapshot; host leaves in lobby → handoff;
room expires. Frontend: the lobby and race screens are tested against a fake
socket that replays the frames above.
