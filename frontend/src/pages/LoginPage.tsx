import { Link, useNavigate } from 'react-router'
import { AuthForm } from '../features/auth/AuthForm'
import { useAuth } from '../features/auth/store'

export default function LoginPage() {
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()

  return (
    <main className="flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Log in</h1>
      <AuthForm
        mode="login"
        onSubmit={async ({ email, password }) => {
          await login(email, password)
          navigate('/')
        }}
      />
      <p className="text-sm">
        No account? <Link className="underline" to="/register">Create one</Link>
      </p>
    </main>
  )
}
