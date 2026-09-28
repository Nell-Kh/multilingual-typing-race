import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'
import { directionOf } from '../../i18n/languages'
import type { Language } from '../../lib/api'
import { charStatuses, type EngineState } from './engine'
import { CARET, SIZE, STATUS_CLASS } from './styles'

interface Props {
  state: EngineState
  language: Language
  onInput: (value: string, at: number) => void
  /** Show the text but refuse input (a race countdown). */
  locked?: boolean
  /** Esc while typing: start this text over. */
  onRestart?: () => void
}

/**
 * The text to type, with a transparent <input> laid over it. The input owns the
 * keyboard (so mobile keyboards, IME composition and accessibility all work); the
 * spans underneath show progress.
 *
 * One <span> per character works for Hebrew and Arabic too: browsers shape
 * cursive letters across inline boundaries as long as every span has the same
 * font (see ADR-014 and docs/rtl-notes.md). The only per-language differences
 * are `dir`, `lang` (which selects the font via CSS `:lang()`), and size.
 */
export function TypingBox({ state, language, onInput, locked = false, onRestart }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const [composing, setComposing] = useState(false)
  const [focused, setFocused] = useState(false)
  const statuses = charStatuses(state)
  const dir = directionOf(language)

  useEffect(() => {
    if (!locked) inputRef.current?.focus()
  }, [state.target, locked])

  // Keep the line being typed on screen: on a phone the keyboard covers the lower
  // half, and the visual viewport is what is actually visible above it.
  useEffect(() => {
    const caret = textRef.current?.querySelector<HTMLElement>('[data-caret]')
    if (!caret || typeof caret.scrollIntoView !== 'function') return
    const visible = window.visualViewport?.height ?? window.innerHeight
    const { top, bottom } = caret.getBoundingClientRect()
    if (top < 0 || bottom > visible - 16) caret.scrollIntoView({ block: 'center' })
  }, [state.typed])

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // During IME composition the value is provisional; wait for compositionend.
    if (composing) return
    onInput(e.target.value, performance.now())
  }

  function handleCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
    setComposing(false)
    onInput(e.currentTarget.value, performance.now())
  }

  const waiting = !focused && !locked && !state.finished

  return (
    <div
      dir={dir}
      lang={language}
      data-testid="typing-box"
      data-focused={focused}
      className={`typing-text relative w-full cursor-text rounded-card border bg-surface px-5 py-6 text-start sm:px-8 sm:py-8
        ${SIZE[language === 'ar' ? 'ar' : 'other']}
        ${focused ? 'border-accent ring-2 ring-accent-soft' : 'border-line'}`}
      onClick={() => inputRef.current?.focus()}
    >
      <p
        ref={textRef}
        aria-hidden="true"
        className={`m-0 whitespace-pre-wrap break-words select-none ${waiting ? 'opacity-40' : ''}`}
      >
        {Array.from(state.target).map((ch, i) => {
          const status = statuses[i]
          const caret = status === 'current' && !locked
          return (
            <span
              key={i}
              data-caret={caret || undefined}
              className={`${STATUS_CLASS[status]} ${caret ? CARET[dir] : ''}`}
            >
              {ch}
            </span>
          )
        })}
      </p>
      {waiting && (
        <div
          dir="ltr"
          lang="en"
          data-testid="click-to-start"
          className="pointer-events-none absolute inset-0 grid place-items-center font-sans text-sm leading-normal"
        >
          <span className="rounded-full border border-line bg-surface px-4 py-2 font-medium text-accent shadow-sm">
            Click here or press Tab to type
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        dir={dir}
        lang={language}
        aria-label="Type the text above"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        value={state.typed}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onRestart) {
            e.preventDefault()
            onRestart()
          }
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={handleCompositionEnd}
        // Convenience only: the server's validator is the real paste defence (ADR-015).
        onPaste={(e) => e.preventDefault()}
        disabled={state.finished || locked}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  )
}
