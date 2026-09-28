import { Link, useNavigate } from 'react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { AuthForm } from '../features/auth/AuthForm'
import { useAuth } from '../features/auth/store'
import { useTitle } from '../ui/useTitle'

export default function LoginPage() {
  useTitle('Log in')
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()

  return (
    <AuthCard
      title="Log in"
      footer={
        <>
          No account?{' '}
          <Link className="font-medium text-accent underline" to="/register">
            Create one
          </Link>
        </>
      }
    >
      <AuthForm
        mode="login"
        onSubmit={async ({ email, password }) => {
          await login(email, password)
          navigate('/')
        }}
      />
    </AuthCard>
  )
}
