import { Link } from 'react-router'
import { TypingPreview } from '../features/typing-engine/TypingPreview'
import { Tagline } from '../ui/Tagline'
import { useTitle } from '../ui/useTitle'

const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-control px-5 text-sm font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** What a visitor sees at "/" before signing in. */
export default function LandingPage() {
  useTitle()
  return (
    <main className="flex flex-col gap-10 p-4 py-10 sm:p-8 sm:py-16">
      <section className="flex max-w-2xl flex-col gap-4">
        <h1 className="m-0 text-3xl leading-tight font-bold text-balance sm:text-4xl">
          Typing practice and live races with your friends.
        </h1>
        <Tagline className="text-lg" />
        <p className="m-0 max-w-[60ch] text-ink">
          The server replays every keystroke to score a run, so a number on the leaderboard is one
          somebody typed. Hebrew and Arabic work properly: right to left, with the letters a
          keyboard can type, and Arabic letters that stay joined as you go.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link to="/register" className={`${LINK_BUTTON} bg-accent text-surface hover:opacity-90`}>
            Create account
          </Link>
          <Link to="/login" className={`${LINK_BUTTON} border border-line bg-surface text-ink hover:bg-paper`}>
            Log in
          </Link>
        </div>
      </section>

      <section aria-label="What typing looks like" className="grid gap-3 sm:grid-cols-3">
        <TypingPreview language="en" text="The train leaves at seven." typed={11} wrongAt={10} />
        <TypingPreview language="he" text="הרכבת יוצאת בשבע." typed={6} />
        <TypingPreview language="ar" text="يغادر القطار في السابعة." typed={10} wrongAt={9} />
      </section>
    </main>
  )
}
