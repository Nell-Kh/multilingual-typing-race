// Typed client for the backend. Every request goes through here, so the base URL,
// auth header, error shape and token refresh live in one place.

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/** The backend's one error shape: `{"error": {"code", "message", ...}}`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// ---- access token ------------------------------------------------------------
// Kept in memory only (never localStorage): a script injected into the page
// can't read it, and it's gone when the tab closes. The refresh cookie brings it back.

let accessToken: string | null = null
export function setAccessToken(token: string | null): void {
  accessToken = token
}
export function getAccessToken(): string | null {
  return accessToken
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
}

let refreshInFlight: Promise<string | null> | null = null

/**
 * Ask the API for a new access token using the refresh cookie. Null if there is none.
 *
 * At most one of these runs at a time. Refreshing *rotates* the token (ADR-009): the
 * cookie is spent by the first request to arrive, so a second one sent in parallel is
 * asking with a token that no longer exists and is rejected — and its `setAccessToken(null)`
 * would then log out a session the first call had just renewed. That happens for real:
 * three stats queries firing together after the access token expires, two tabs waking
 * at once, or React's StrictMode running the bootstrap effect twice. Callers share the
 * one request instead.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function requestRefresh(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    setAccessToken(null)
    return null
  }
  const body = (await res.json()) as TokenResponse
  setAccessToken(body.access_token)
  return body.access_token
}

// ---- request helper ----------------------------------------------------------

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  auth?: boolean
  /** internal: whether a 401 has already triggered one refresh attempt */
  retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retried = false } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include', // send/receive the refresh cookie on auth routes
  })

  // Access token expired: refresh once, then replay the request.
  if (res.status === 401 && auth && !retried) {
    const fresh = await refreshAccessToken()
    if (fresh) return request<T>(path, { ...options, retried: true })
  }

  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText, err?.details)
  }
  return data as T
}

// ---- endpoints ---------------------------------------------------------------

export type CheckResult = 'ok' | 'error'
export interface HealthResponse {
  status: 'ok' | 'degraded'
  checks: Record<string, CheckResult>
}
export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/healthz`)
  return (await res.json()) as HealthResponse
}

export type Language = 'he' | 'ar' | 'en'

export interface User {
  id: string
  email: string
  display_name: string
  role: 'user' | 'admin'
  preferred_language: Language
  created_at: string
}

export const auth = {
  register: (email: string, password: string, display_name: string) =>
    request<TokenResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, display_name },
      auth: false,
    }),
  login: (email: string, password: string) =>
    request<TokenResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST', auth: false }),
  me: () => request<User>('/api/v1/auth/me'),
}

// ---- texts & sessions -----------------------------------------------------------

export interface Text {
  id: string
  language: Language
  content: string
  char_count: number
  difficulty: 1 | 2 | 3
  source: string
  license: string
  is_active: boolean
  created_at: string
}

export const texts = {
  random: (lang: Language, difficulty?: 1 | 2 | 3) => {
    const params = new URLSearchParams({ lang })
    if (difficulty) params.set('difficulty', String(difficulty))
    return request<Text>(`/api/v1/texts/random?${params}`, { auth: false })
  },
}

/** [t_ms, expected, typed] — see features/typing-engine/engine.ts */
export type KeystrokeLog = [number, string, string][]

export interface KeyStat {
  key: string
  correct: number
  errors: number
  avg_latency_ms: number | null
}

export interface SessionResult {
  id: string
  text_id: string
  mode: 'practice' | 'race' | 'daily'
  language: Language
  started_at: string
  finished_at: string
  duration_ms: number
  wpm: number
  cpm: number
  raw_wpm: number
  accuracy: number
  error_count: number
  keystroke_count: number
  is_valid: boolean
  invalid_reason: string | null
  created_at: string
  key_stats: KeyStat[]
}

export const sessions = {
  submit: (
    text_id: string,
    started_at: string,
    keystrokes: KeystrokeLog,
    mode: 'practice' | 'daily' = 'practice',
  ) =>
    request<SessionResult>('/api/v1/sessions', {
      method: 'POST',
      body: { text_id, mode, started_at, keystrokes },
    }),
}

// ---- rooms (races) ----------------------------------------------------------------
// The live part of a race runs over a WebSocket (features/race/socket.ts); these are
// the two plain HTTP calls around it. Frames: docs/race-protocol.md.

export interface RoomPlayer {
  id: string
  display_name: string
  connected: boolean
  typed: number
  errors: number
  finished_at: string | null
  place: number | null
  wpm: number | null
  accuracy: number | null
  valid: boolean | null
}

export interface RoomPreview {
  code: string
  state: 'lobby' | 'countdown' | 'running' | 'finished'
  host_id: string
  language: Language
  difficulty: 1 | 2 | 3
  players: RoomPlayer[]
}

export const rooms = {
  create: (language: Language, difficulty: 1 | 2 | 3) =>
    request<RoomPreview>('/api/v1/rooms', { method: 'POST', body: { language, difficulty } }),
  preview: (code: string) =>
    request<RoomPreview>(`/api/v1/rooms/${encodeURIComponent(code)}`, { auth: false }),
}

/** ws(s)://… for the room socket, derived from the API URL. */
export function roomSocketUrl(code: string): string {
  const base = API_URL.replace(/^http/, 'ws')
  return `${base}/api/v1/rooms/${encodeURIComponent(code)}/ws`
}

// ---- stats, leaderboards, daily (ADR-019) -----------------------------------------------

export interface LanguageStats {
  language: Language
  runs: number
  best_wpm: number
  avg_wpm: number
  avg_accuracy: number
  total_time_ms: number
}

export interface TrendPoint {
  started_at: string
  language: Language
  mode: 'practice' | 'race' | 'daily'
  wpm: number
  accuracy: number
}

export interface Stats {
  languages: LanguageStats[]
  trend: TrendPoint[]
}

export type SessionSummary = Omit<SessionResult, 'key_stats'>

export interface SessionPage {
  items: SessionSummary[]
  next_cursor: string | null
}

export interface KeyAggregate {
  key: string
  correct: number
  errors: number
  error_rate: number
  avg_latency_ms: number | null
}

export type Period = 'day' | 'week' | 'all'

export interface LeaderboardRow {
  rank: number
  user_id: string
  display_name: string
  wpm: number
  accuracy: number
  started_at: string
}

export interface Leaderboard {
  language: Language
  period: string
  rows: LeaderboardRow[]
  me: LeaderboardRow | null
}

export interface Daily {
  day: string
  language: Language
  text: Text
}

export const stats = {
  me: () => request<Stats>('/api/v1/me/stats'),
  sessions: (lang?: Language, cursor?: string) => {
    const params = new URLSearchParams()
    if (lang) params.set('lang', lang)
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return request<SessionPage>(`/api/v1/me/sessions${qs ? `?${qs}` : ''}`)
  },
  keys: (lang: Language) =>
    request<{ language: Language; keys: KeyAggregate[] }>(`/api/v1/me/keys?lang=${lang}`),
}

export const leaderboards = {
  get: (lang: Language, period: Period) =>
    // auth: the server adds "your row" when a token is present; anonymous works too.
    request<Leaderboard>(`/api/v1/leaderboards?lang=${lang}&period=${period}`),
  daily: (lang: Language) => request<Leaderboard>(`/api/v1/daily/leaderboard?lang=${lang}`),
}

export const daily = {
  get: (lang: Language) => request<Daily>(`/api/v1/daily?lang=${lang}`, { auth: false }),
}
