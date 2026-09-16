import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'
import { directionOf } from '../../i18n/languages'
import type { Language } from '../../lib/api'
import { charStatuses, type EngineState } from './engine'

interface Props {
  state: EngineState
  language: Language
  onInput: (value: string, at: number) => void
}

const STATUS_CLASS = {
  correct: 'text-green-700 dark:text-green-400',
  incorrect: 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-sm',
  current: 'border-b-2 border-blue-500',
  pending: 'text-gray-400',
} as const

/**
 * The text to type, with a transparent <input> laid over it. The input owns the
 * keyboard (so mobile keyboards, IME composition and accessibility all work); the
 * spans underneath show progress.
 *
 * One <span> per character works for Hebrew and Arabic too: browsers shape
 * cursive letters across inline boundaries as long as every span has the same
 * font (see ADR-014 and docs/rtl-notes.md). The only per-language differences
 * are `dir`, `lang` (which selects the font via CSS `:lang()`), and the fact
 * that nothing here is monospace.
 */
export function TypingBox({ state, language, onInput }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [composing, setComposing] = useState(false)
  const statuses = charStatuses(state)
  const dir = directionOf(language)

  useEffect(() => {
    inputRef.current?.focus()
  }, [state.target])

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // During IME composition the value is provisional; wait for compositionend.
    if (composing) return
    onInput(e.target.value, performance.now())
  }

  function handleCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
    setComposing(false)
    onInput(e.currentTarget.value, performance.now())
  }

  return (
    <div
      dir={dir}
      lang={language}
      data-testid="typing-box"
      className="typing-text relative mx-auto max-w-3xl cursor-text rounded-lg border p-6 text-start text-2xl leading-relaxed"
      onClick={() => inputRef.current?.focus()}
    >
      <p aria-hidden="true" className="whitespace-pre-wrap break-words select-none">
        {Array.from(state.target).map((ch, i) => (
          <span key={i} className={STATUS_CLASS[statuses[i]]}>
            {ch}
          </span>
        ))}
      </p>
      <input
        ref={inputRef}
        dir={dir}
        lang={language}
        aria-label="Type the text above"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        value={state.typed}
        onChange={handleChange}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={handleCompositionEnd}
        // Convenience only: the server's validator is the real paste defence (ADR-015).
        onPaste={(e) => e.preventDefault()}
        disabled={state.finished}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  )
}
