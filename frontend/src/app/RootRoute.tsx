import { useAuth } from '../features/auth/store'
import HomePage from '../pages/HomePage'
import LandingPage from '../pages/LandingPage'
import { AppShell } from './AppShell'
import { PublicShell } from './PublicShell'

/** "/" is the landing page for visitors and the home page once signed in. */
export function RootRoute() {
  const status = useAuth((s) => s.status)
  if (status === 'unknown') return <p className="p-4 sm:p-8">Loading…</p>
  if (status === 'anonymous')
    return (
      <PublicShell>
        <LandingPage />
      </PublicShell>
    )
  return (
    <AppShell>
      <HomePage />
    </AppShell>
  )
}
