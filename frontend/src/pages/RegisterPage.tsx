import { Link, useNavigate } from 'react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { AuthForm } from '../features/auth/AuthForm'
import { useAuth } from '../features/auth/store'
import { useTitle } from '../ui/useTitle'

export default function RegisterPage() {
  useTitle('Create account')
  const register = useAuth((s) => s.register)
  const navigate = useNavigate()

  return (
    <AuthCard
      title="Create account"
      footer={
        <>
          Already have one?{' '}
          <Link className="font-medium text-accent underline" to="/login">
            Log in
          </Link>
        </>
      }
    >
      <AuthForm
        mode="register"
        onSubmit={async ({ email, password, displayName }) => {
          await register(email, password, displayName)
          navigate('/')
        }}
      />
    </AuthCard>
  )
}
