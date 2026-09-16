import { Link, useNavigate } from 'react-router'
import { AuthForm } from '../features/auth/AuthForm'
import { useAuth } from '../features/auth/store'

export default function RegisterPage() {
  const register = useAuth((s) => s.register)
  const navigate = useNavigate()

  return (
    <main className="flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Create account</h1>
      <AuthForm
        mode="register"
        onSubmit={async ({ email, password, displayName }) => {
          await register(email, password, displayName)
          navigate('/')
        }}
      />
      <p className="text-sm">
        Already have one? <Link className="underline" to="/login">Log in</Link>
      </p>
    </main>
  )
}
