import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../features/auth/store'
import { loadPracticeLanguage } from '../i18n/languages'
import { Button } from './Button'
import { Wordmark } from './Wordmark'

type Item = { label: string; to: string; active: (path: string, daily: boolean) => boolean }

const ITEMS: Item[] = [
  { label: 'Practice', to: '/practice', active: (p, daily) => p === '/practice' && !daily },
  { label: 'Race', to: '/race', active: (p) => p === '/race' || p.startsWith('/race/') },
  { label: 'Daily', to: '/practice?daily=1', active: (p, daily) => p === '/practice' && daily },
  { label: 'Stats', to: '/stats', active: (p) => p === '/stats' },
  { label: 'Leaderboard', to: '/leaderboard', active: (p) => p === '/leaderboard' },
]

/** Top of every signed-in page: product name, the five places you can go, you. */
export function AppHeader() {
  const { pathname, search } = useLocation()
  const daily = new URLSearchParams(search).get('daily') === '1'

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2">
        <Wordmark />
        {/* On a phone the nav takes its own row and scrolls inside itself, never the page. */}
        <nav
          aria-label="Main"
          className="order-last -mx-2 flex basis-full justify-between overflow-x-auto sm:order-none sm:mx-0 sm:basis-auto sm:flex-1 sm:justify-start sm:gap-1"
        >
          {ITEMS.map((item) => {
            const current = item.active(pathname, daily)
            const to =
              item.label === 'Daily' ? `/practice?daily=1&lang=${loadPracticeLanguage()}` : item.to
            return (
              <Link
                key={item.label}
                to={to}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center rounded-control px-2 text-[13px] font-medium sm:px-3 sm:text-sm
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                  ${current ? 'bg-paper text-ink' : 'text-muted hover:text-ink'}`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <UserMenu />
      </div>
    </header>
  )
}

function UserMenu() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!user) return null
  const initial = Array.from(user.display_name.trim())[0]?.toUpperCase() ?? '?'

  return (
    <div ref={box} className="relative ms-auto">
      <button
        type="button"
        aria-label={`Account: ${user.display_name}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {initial}
      </button>
      {open && (
        <div
          className="absolute end-0 top-12 z-10 flex w-56 flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-lg"
          data-testid="user-menu"
        >
          <p className="truncate text-sm">
            Signed in as <strong>{user.display_name}</strong>
          </p>
          <Button
            variant="secondary"
            // To the log-in page, not "/", which is now the landing page for visitors.
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            Log out
          </Button>
        </div>
      )}
    </div>
  )
}
