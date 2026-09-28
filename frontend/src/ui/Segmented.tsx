import type { ReactNode } from 'react'

interface Option<T> {
  value: T
  label: ReactNode
  /** Sets the font for a label in another script (עברית, العربية). */
  lang?: string
}

interface Props<T> {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * A row of mutually exclusive choices (ADR-032). Each option is a real button
 * with aria-pressed inside a labelled group, so it works by keyboard and reads
 * as "Language, group: English, pressed" to a screen reader.
 */
export function Segmented<T extends string | number>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="inline-flex gap-0.5 rounded-[10px] border border-line bg-paper p-0.5"
      >
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={String(o.value)}
              type="button"
              lang={o.lang}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`min-h-10 min-w-10 rounded-control px-3 text-sm font-medium
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                ${on ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
