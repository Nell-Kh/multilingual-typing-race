import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../../lib/api'
import { Button } from '../../ui/Button'

interface Props {
  mode: 'login' | 'register'
  onSubmit: (fields: { email: string; password: string; displayName: string }) => Promise<void>
}

type Field = 'displayName' | 'email' | 'password'
type Errors = Partial<Record<Field | 'form', string>>

const PASSWORD_MIN = 8 // backend/app/schemas/auth.py
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Checked before anything is sent, in words rather than the browser's own bubbles. */
function validate(mode: Props['mode'], v: Record<Field, string>): Errors {
  const e: Errors = {}
  if (mode === 'register') {
    if (!v.displayName.trim()) e.displayName = 'Enter the name other players will see.'
    else if (v.displayName.trim().length > 50) e.displayName = 'Keep it to 50 characters or fewer.'
  }
  if (!v.email.trim()) e.email = 'Enter your email address.'
  else if (!EMAIL.test(v.email.trim())) e.email = 'That doesn’t look like an email address (name@example.com).'
  if (!v.password) e.password = 'Enter your password.'
  else if (mode === 'register' && v.password.length < PASSWORD_MIN)
    e.password = `Use at least ${PASSWORD_MIN} characters.`
  return e
}

/** Where a server refusal belongs: under the field it is about, or above the button. */
function fromServer(err: unknown): Errors {
  if (!(err instanceof ApiError)) return { form: 'Could not reach the server. Check your connection and try again.' }
  if (err.code === 'invalid_credentials') return { password: 'Email or password is incorrect.' }
  if (err.code === 'email_taken') return { email: 'There is already an account with this email. Log in instead.' }
  if (err.status === 422 && Array.isArray(err.details)) {
    const byField: Errors = {}
    for (const d of err.details as { field?: string; message?: string }[]) {
      const key = d.field === 'display_name' ? 'displayName' : d.field
      if (key === 'displayName' || key === 'email' || key === 'password') byField[key] = d.message
    }
    if (Object.keys(byField).length) return byField
  }
  return { form: err.message }
}

/** One form for both login and register; the parent decides what to do with it. */
export function AuthForm({ mode, onSubmit }: Props) {
  const id = useId()
  const [values, setValues] = useState<Record<Field, string>>({ displayName: '', email: '', password: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(mode, values)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setErrors(fromServer(err))
    } finally {
      setBusy(false)
    }
  }

  function field(name: Field, label: string, input: { type?: string; autoComplete: string }) {
    const error = errors[name]
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={`${id}-${name}`}
          type={input.type ?? 'text'}
          autoComplete={input.autoComplete}
          value={values[name]}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-${name}-error` : undefined}
          className={`min-h-11 rounded-control border bg-surface px-3 text-ink
            focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
            ${error ? 'border-err' : 'border-line'}`}
        />
        {error && (
          <p id={`${id}-${name}-error`} role="alert" className="m-0 text-sm text-err">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
      {mode === 'register' && field('displayName', 'Display name', { autoComplete: 'nickname' })}
      {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
      {field('password', 'Password', {
        type: 'password',
        autoComplete: mode === 'login' ? 'current-password' : 'new-password',
      })}
      {errors.form && (
        <p role="alert" className="m-0 rounded-control bg-err-soft px-3 py-2 text-sm text-err">
          {errors.form}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy} aria-busy={busy} className="min-h-11">
        {busy
          ? mode === 'login'
            ? 'Logging in…'
            : 'Creating account…'
          : mode === 'login'
            ? 'Log in'
            : 'Create account'}
      </Button>
    </form>
  )
}
