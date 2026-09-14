// Typed client for the backend. Every request goes through here so the base URL,
// error handling and (later) auth headers live in one place.

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type CheckResult = 'ok' | 'error'

export interface HealthResponse {
  status: 'ok' | 'degraded'
  checks: Record<string, CheckResult>
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/healthz`)
  // /healthz answers 503 when degraded but still returns the JSON body, so
  // we read it regardless of status and only fail on a non-JSON response.
  return (await res.json()) as HealthResponse
}
