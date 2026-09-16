import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'
import { charStatuses, type EngineState } from './engine'

interface Props {
  state: EngineState
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
 * spans underneath show progress. Per-character spans are fine for English; M3
 * replaces this renderer for Hebrew/Arabic, where spans break letter shaping.
 */
export function TypingBox({ state, onInput }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [composing, setComposing] = useState(false)
  const statuses = charStatuses(state)

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
      className="relative mx-auto max-w-3xl cursor-text rounded-lg border p-6 text-2xl leading-relaxed"
      onClick={() => inputRef.current?.focus()}
    >
      <p aria-hidden="true" className="whitespace-pre-wrap break-words font-mono select-none">
        {Array.from(state.target).map((ch, i) => (
          <span key={i} className={STATUS_CLASS[statuses[i]]}>
            {ch}
          </span>
        ))}
      </p>
      <input
        ref={inputRef}
        aria-label="Type the text above"
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        value={state.typed}
        onChange={handleChange}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={handleCompositionEnd}
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
