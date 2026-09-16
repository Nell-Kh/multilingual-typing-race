import { useState, type FormEvent } from 'react'
import { ApiError } from '../../lib/api'

interface Props {
  mode: 'login' | 'register'
  onSubmit: (fields: { email: string; password: string; displayName: string }) => Promise<void>
}

/** One form for both login and register; the parent decides what to do with it. */
export function AuthForm({ mode, onSubmit }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSubmit({ email, password, displayName })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      {mode === 'register' && (
        <label className="flex flex-col gap-1">
          <span className="text-sm">Display name</span>
          <input
            className="rounded border px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={50}
            autoComplete="nickname"
          />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm">Email</span>
        <input
          className="rounded border px-3 py-2"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Password</span>
        <input
          className="rounded border px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={128}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
    </form>
  )
}
