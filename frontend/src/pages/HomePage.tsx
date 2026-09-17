import { Link } from 'react-router'
import { useAuth } from '../features/auth/store'

export default function HomePage() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)

  return (
    <main className="flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Multilingual Typing Race</h1>
      <p>
        Signed in as <strong data-testid="display-name">{user?.display_name}</strong>
      </p>
      <div className="flex gap-4">
        <Link to="/practice" className="rounded bg-blue-600 px-6 py-3 text-lg text-white">
          Practice
        </Link>
        <Link to="/race" className="rounded border px-6 py-3 text-lg">
          Race
        </Link>
      </div>
      <nav className="flex gap-4 text-sm">
        <Link className="underline" to="/stats">
          Your stats
        </Link>
        <Link className="underline" to="/leaderboard">
          Leaderboard
        </Link>
      </nav>
      <button className="rounded border px-4 py-2" onClick={() => void logout()}>
        Log out
      </button>
    </main>
  )
}
