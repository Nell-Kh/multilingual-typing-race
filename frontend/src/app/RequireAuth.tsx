import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../features/auth/store'

/** Wraps routes that need a logged-in user. Waits for bootstrap before deciding. */
export function RequireAuth() {
  const status = useAuth((s) => s.status)
  if (status === 'unknown') return <p className="p-8">Loading…</p>
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <Outlet />
}
