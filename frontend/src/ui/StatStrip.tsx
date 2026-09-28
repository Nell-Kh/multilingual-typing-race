import type { ReactNode } from 'react'

export interface Stat {
  label: string
  value: ReactNode
  testId?: string
}

/**
 * Four numbers in a row: small-caps labels, tabular figures so digits do not
 * jump as they change. Two per row on a phone.
 */
export function StatStrip({ stats, label, size = 'md' }: { stats: Stat[]; label: string; size?: 'md' | 'lg' }) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{s.label}</dt>
          <dd
            data-testid={s.testId}
            className={`m-0 font-bold tabular-nums ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
