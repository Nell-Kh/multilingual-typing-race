import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { AppHeader } from '../ui/AppHeader'

/** Every signed-in page: the header, then the page in one centred column (ADR-032). */
export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="mx-auto w-full max-w-page">
        {children ?? <Outlet />}
      </div>
    </>
  )
}
