import { directionOf } from '../../i18n/languages'
import type { Language } from '../../lib/api'
import { CARET, STATUS_CLASS } from './styles'

interface Props {
  language: Language
  text: string
  /** How many characters are shown as typed (the caret sits after them). */
  typed: number
  /** Index of one typed character shown wrong, if any; must be below `typed`. */
  wrongAt?: number
}

/**
 * A still picture of the typing box, for pages that show what typing looks like
 * without taking input. Same spans, same classes as the live box, so it cannot
 * drift from the real thing.
 */
export function TypingPreview({ language, text, typed, wrongAt }: Props) {
  const dir = directionOf(language)
  return (
    <p
      dir={dir}
      lang={language}
      aria-hidden="true"
      className={`m-0 rounded-card border border-line bg-surface px-4 py-3 text-start whitespace-pre-wrap break-words
        ${language === 'ar' ? 'text-xl leading-[2]' : 'text-lg leading-[1.8]'}`}
    >
      {Array.from(text).map((ch, i) => {
        const status = i === wrongAt ? 'incorrect' : i < typed ? 'correct' : i === typed ? 'current' : 'pending'
        return (
          <span key={i} className={`${STATUS_CLASS[status]} ${status === 'current' ? CARET[dir] : ''}`}>
            {ch}
          </span>
        )
      })}
    </p>
  )
}
