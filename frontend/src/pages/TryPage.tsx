import { Navigate } from 'react-router'
import PracticePage from '../features/practice/PracticePage'
import { useAuth } from '../features/auth/store'

/**
 * /try — practice without an account (ADR-034). Signed-in players go to the real
 * practice page instead, where their runs are kept.
 */
export default function TryPage() {
  const status = useAuth((s) => s.status)
  if (status === 'unknown') return <p className="p-4 sm:p-8">Loading…</p>
  if (status === 'authenticated') return <Navigate to="/practice" replace />
  return <PracticePage guest />
}
