import type { Direction } from '../../i18n/languages'

export interface Runner {
  id: string
  name: string
  /** A short note after the name: "you", "60 wpm", "#1 today". */
  note: string
  typed: number
  highlight?: boolean
}

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

/**
 * You and whoever you are typing against, drawn like the rows of a race (ADR-035).
 * The bars fill from the start edge of the text's direction, as in a race.
 */
export function PaceRows({ runners, total, dir }: { runners: Runner[]; total: number; dir: Direction }) {
  return (
    <ol aria-label="pace" className="m-0 flex list-none flex-col gap-2 p-0">
      {runners.map((r) => {
        const pct = total ? Math.min(100, Math.round((r.typed / total) * 100)) : 0
        return (
          <li
            key={r.id}
            data-testid={`pace-${r.id}`}
            className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-card border px-3 py-2
              sm:grid-cols-[2rem_9rem_minmax(0,1fr)_5rem]
              ${r.highlight ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface'}`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold
                ${r.highlight ? 'bg-accent text-surface' : 'bg-accent-soft text-accent'}`}
            >
              {initial(r.name)}
            </span>
            <span className="truncate text-sm font-medium">
              <bdi>{r.name}</bdi> <span className="text-xs font-normal text-muted">{r.note}</span>
            </span>
            <div
              dir={dir}
              data-testid={`pace-bar-${r.id}`}
              className="col-span-3 row-start-2 h-2.5 overflow-hidden rounded-full border border-line bg-paper sm:col-span-1 sm:row-start-auto"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${r.name} progress`}
              />
            </div>
            <span className="col-start-3 row-start-1 text-end text-sm font-medium tabular-nums sm:col-start-auto sm:row-start-auto">
              {pct}%
            </span>
          </li>
        )
      })}
    </ol>
  )
}
