// Who is logged in. One store, read anywhere via the hook; changes re-render subscribers.

import { create } from 'zustand'
import { auth, refreshAccessToken, setAccessToken, type User } from '../../lib/api'

type Status = 'unknown' | 'anonymous' | 'authenticated'

interface AuthState {
  status: Status
  user: User | null
  /** On page load: try the refresh cookie; if it works, load the user. */
  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,

  bootstrap: async () => {
    const token = await refreshAccessToken().catch(() => null)
    if (!token) {
      set({ status: 'anonymous', user: null })
      return
    }
    const user = await auth.me()
    set({ status: 'authenticated', user })
  },

  login: async (email, password) => {
    const tokens = await auth.login(email, password)
    setAccessToken(tokens.access_token)
    set({ status: 'authenticated', user: await auth.me() })
  },

  register: async (email, password, displayName) => {
    const tokens = await auth.register(email, password, displayName)
    setAccessToken(tokens.access_token)
    set({ status: 'authenticated', user: await auth.me() })
  },

  logout: async () => {
    await auth.logout().catch(() => undefined)
    setAccessToken(null)
    set({ status: 'anonymous', user: null })
  },
}))
