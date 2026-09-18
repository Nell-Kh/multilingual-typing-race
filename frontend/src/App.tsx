import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { RouterProvider } from 'react-router'
import { createRouter } from './app/router'
import { useAuth } from './features/auth/store'

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // One retry, then say so. The default of three means a page sits on "Loading…"
        // for about seven seconds before admitting the request failed, and every empty
        // state on the stats page looks exactly like a page that is still trying.
        defaultOptions: { queries: { retry: 1 } },
      }),
  )
  const [router] = useState(() => createRouter())
  const bootstrap = useAuth((s) => s.bootstrap)
  const userId = useAuth((s) => s.user?.id ?? null)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // The cache is keyed by what was asked for, not by who asked, so ['me','stats']
  // means "the signed-in user's stats" — and on a shared browser the next person to
  // sign in would be shown the last person's numbers until the refetch lands. Dropping
  // the cache when the identity changes is what makes those keys honest. The first
  // identity of a page load is not a change: there is nothing cached to drop, and
  // clearing then would throw away a warm cache on every load.
  const lastUserId = useRef<string | null>(null)
  useEffect(() => {
    if (lastUserId.current !== null && lastUserId.current !== userId) queryClient.clear()
    lastUserId.current = userId
  }, [userId, queryClient])

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
