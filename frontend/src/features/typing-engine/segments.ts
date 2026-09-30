// Turning per-character statuses into as few spans as possible, so Arabic stays
// joined in every browser (ADR-036).
//
// Chromium shapes cursive text across inline elements; WebKit (Safari, and every
// browser on an iPhone) shapes each element on its own, so one <span> per letter
// shows every Arabic letter in its isolated form. Here letters with the same status
// share one text run, which leaves at most three boundaries in a line (after the
// typed text, around a wrong letter, around the caret letter), and at a boundary
// between two letters that connect, each side gets a zero-width joiner (U+200D):
// the standard way to ask for the joined form across a break. It has no width and
// is never typed; it is display only.

import type { CharStatus } from './engine'

export const ZWJ = '‍'

/** Letters that connect only to the letter before them (Unicode joining type R). */
const JOINS_BEFORE_ONLY = new Set(Array.from('آأؤإاةدذرزو'))

type JoiningType = 'dual' | 'right' | 'none'

export function joiningType(ch: string): JoiningType {
  if (JOINS_BEFORE_ONLY.has(ch)) return 'right'
  const code = ch.codePointAt(0) ?? 0
  // Arabic letters U+0620–U+064A (hamza on its own, U+0621, never joins) and the tatweel.
  if (code === 0x0640 || (code >= 0x0620 && code <= 0x064a && code !== 0x0621)) return 'dual'
  return 'none'
}

/** Does `a` connect to the letter after it, `b`, in logical (typing) order? */
export function joins(a: string, b: string): boolean {
  const next = joiningType(b)
  return joiningType(a) === 'dual' && (next === 'dual' || next === 'right')
}

export interface Segment {
  /** Index of the segment's first character in the text: a stable React key. */
  start: number
  text: string
  status: CharStatus
  caret: boolean
}

export function segments(chars: string[], statuses: CharStatus[], caretAt: number | null): Segment[] {
  const out: Segment[] = []
  chars.forEach((ch, i) => {
    const status = statuses[i]
    const caret = i === caretAt
    const last = out[out.length - 1]
    // A wrong letter and the caret letter always get their own span; the rest runs on.
    const alone = caret || status === 'incorrect' || status === 'current'
    const lastAlone = last && (last.caret || last.status === 'incorrect' || last.status === 'current')
    if (last && !alone && !lastAlone && last.status === status) last.text += ch
    else out.push({ start: i, text: ch, status, caret })
  })
  for (let k = 0; k + 1 < out.length; k++) {
    const a = chars[out[k + 1].start - 1]
    const b = chars[out[k + 1].start]
    if (joins(a, b)) {
      out[k].text += ZWJ
      out[k + 1].text = ZWJ + out[k + 1].text
    }
  }
  return out
}
