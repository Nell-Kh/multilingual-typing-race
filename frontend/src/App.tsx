import { useEffect, useState } from 'react'
import { API_URL, getHealth, type HealthResponse } from './lib/api'

type State = { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>Multilingual Typing Race</h1>
      <p>
        API: <code>{API_URL}</code>
      </p>
      {state.kind === 'loading' && <p>Checking API…</p>}
      {state.kind === 'error' && <p role="alert">API unreachable: {state.message}</p>}
      {state.kind === 'ok' && (
        <>
          <p>
            API status: <strong data-testid="status">{state.data.status}</strong>
          </p>
          <ul>
            {Object.entries(state.data.checks).map(([name, result]) => (
              <li key={name}>
                {name}: {result}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
