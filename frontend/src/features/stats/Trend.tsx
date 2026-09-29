import { useLayoutEffect, useRef, useState } from 'react'
import type { TrendPoint } from '../../lib/api'
import { WINDOW, movingAverage } from './movingAverage'

interface Props {
  points: TrendPoint[]
}

const H = 200
const PAD = { top: 28, right: 12, bottom: 36, left: 40 }

/** A round top for the axis: the next 10 above the fastest run, or 20 past 100. */
function niceMax(max: number): number {
  const step = max > 100 ? 20 : 10
  return Math.max(step, Math.ceil(max / step) * step)
}

/** The chart's pixel width, so text stays at its real size on a phone instead of shrinking with a viewBox. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/**
 * WPM over the last runs as inline SVG: each run as a dot on a thin line, and the
 * 7-run moving average as a thicker line over it. No chart library for two lines
 * and thirty points. Colours are the design tokens (ADR-032); the two lines differ
 * in weight and markers as well as colour.
 */
export function Trend({ points }: Props) {
  const { ref, width } = useWidth(600)

  if (points.length < 2) {
    // The measured box is rendered either way, so the chart has a width the moment a second run arrives.
    return (
      <div ref={ref}>
        <p className="m-0 text-sm text-muted">After your second counted run, your speed over time shows up here.</p>
      </div>
    )
  }

  const W = width
  const top = niceMax(Math.max(...points.map((p) => p.wpm)))
  const ticks = [0, top / 2, top]
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const y = (wpm: number) => PAD.top + plotH - (wpm / top) * plotH
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.wpm).toFixed(1)}`).join(' ')
  const avg = movingAverage(points.map((p) => p.wpm))
  const avgLine = avg
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter((s): s is string => s !== null)
    .join(' ')
  const last = points[points.length - 1]
  const lastAvg = avg[avg.length - 1]

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="w-full">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full"
          role="img"
          aria-label={`WPM over the last ${points.length} runs, latest ${last.wpm}`}
          data-testid="trend"
        >
          {/* y axis: gridlines and their values, and what they measure */}
          <text x={PAD.left - 8} y={12} textAnchor="end" className="fill-muted text-[11px] font-medium">
            WPM
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[11px] tabular-nums"
              >
                {t}
              </text>
            </g>
          ))}
          {/* x axis: order, not dates; a run is a run whether it was a minute or a week after the last */}
          <text x={PAD.left} y={H - 10} className="fill-muted text-[11px]">
            oldest
          </text>
          <text x={W - PAD.right} y={H - 10} textAnchor="end" className="fill-muted text-[11px]">
            latest
          </text>
          <text x={PAD.left + plotW / 2} y={H - 10} textAnchor="middle" className="fill-muted text-[11px] font-medium">
            last {points.length} runs
          </text>

          <polyline points={line} fill="none" className="stroke-accent" strokeOpacity={0.45} strokeWidth={1.5} />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.wpm)} r={3} className="fill-accent">
              <title>{`${p.wpm} wpm · ${p.accuracy}% · ${p.language} ${p.mode}`}</title>
            </circle>
          ))}
          {avgLine && (
            <polyline
              points={avgLine}
              fill="none"
              className="stroke-ink"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              data-testid="trend-average"
            />
          )}
        </svg>
      </div>
      <ul className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-1 p-0 text-xs text-muted" aria-label="Chart key">
        <li className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" x2="21" y1="4" y2="4" className="stroke-accent" strokeOpacity={0.45} strokeWidth={1.5} />
            <circle cx="11" cy="4" r="3" className="fill-accent" />
          </svg>
          each run
        </li>
        <li className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" x2="21" y1="4" y2="4" className="stroke-ink" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          {lastAvg !== null ? (
            <span data-testid="trend-average-now">
              {WINDOW}-run average, now <strong className="text-ink tabular-nums">{lastAvg.toFixed(1)}</strong> wpm
            </span>
          ) : (
            <span data-testid="trend-average-now">
              {WINDOW}-run average, from your {WINDOW}th run ({WINDOW - points.length} to go)
            </span>
          )}
        </li>
      </ul>
    </div>
  )
}
