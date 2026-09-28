// How typed text looks, shared by the live typing box and the static previews.

/*
 * Status is shown with colour, background and box-shadow only (ADR-014, ADR-032):
 * every span keeps identical font properties, no letter-spacing and no
 * inline-block, so Arabic letters stay joined across a status change. A wrong
 * character has a background as well as a colour, so it does not rely on
 * telling red from green.
 */
export const STATUS_CLASS = {
  correct: 'text-ok',
  incorrect: 'rounded-sm bg-err-soft text-err',
  current: 'text-muted',
  pending: 'text-muted',
} as const

// The caret sits on the start edge of the next character: left in LTR, right in RTL.
export const CARET = {
  ltr: 'shadow-[inset_2px_0_0_var(--accent)]',
  rtl: 'shadow-[inset_-2px_0_0_var(--accent)]',
} as const

// Phone-first sizes from the design tokens; Arabic one step larger (ADR-032).
export const SIZE = {
  ar: 'text-typing-ar leading-[2] sm:text-typing-ar-lg',
  other: 'text-typing leading-[1.8] sm:text-typing-lg',
} as const
