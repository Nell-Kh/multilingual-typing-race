import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { Wordmark } from '../ui/Wordmark'

/** Log in and register: the wordmark only, since there is nowhere else to go yet. */
export function PublicShell({ children }: { children?: ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page items-center px-4 py-2">
          <Wordmark />
        </div>
      </header>
      <div className="mx-auto w-full max-w-page">
        {children ?? <Outlet />}
      </div>
    </>
  )
}
