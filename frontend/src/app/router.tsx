import { createBrowserRouter } from 'react-router'
import HomePage from '../pages/HomePage'
import LoginPage from '../pages/LoginPage'
import RegisterPage from '../pages/RegisterPage'
import { RequireAuth } from './RequireAuth'

/** Built per App instance (not at module load) so each test gets a fresh history. */
export function createRouter() {
  return createBrowserRouter([
    { path: '/login', Component: LoginPage },
    { path: '/register', Component: RegisterPage },
    {
      Component: RequireAuth,
      children: [{ path: '/', Component: HomePage }],
    },
  ])
}
