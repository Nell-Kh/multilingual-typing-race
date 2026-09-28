import { Link } from 'react-router'
import { PRODUCT } from './useTitle'

/** The product name as a link home. The key-cap mark matches the favicon. */
export function Wordmark() {
  return (
    <Link
      to="/"
      className="inline-flex min-h-10 items-center gap-2 rounded-control text-lg font-bold text-ink
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md border-2 border-accent text-sm text-accent"
      >
        K
      </span>
      {PRODUCT}
    </Link>
  )
}
