import { useAuth } from '../features/auth/store'

/** Placeholder until the practice page lands in the next step. */
export default function HomePage() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)

  return (
    <main className="flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Multilingual Typing Race</h1>
      <p>
        Signed in as <strong data-testid="display-name">{user?.display_name}</strong>
      </p>
      <button className="rounded border px-4 py-2" onClick={() => void logout()}>
        Log out
      </button>
    </main>
  )
}
