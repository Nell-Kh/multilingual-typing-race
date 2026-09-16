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

/** Ask the API for a new access token using the refresh cookie. Null if there is none. */
export async function refreshAccessToken(): Promise<string | null> {
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
