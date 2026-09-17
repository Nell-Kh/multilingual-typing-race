import type { TrendPoint } from '../../lib/api'

interface Props {
  points: TrendPoint[]
}

const W = 600
const H = 160
const PAD = 24

/**
 * WPM over the last runs, as a plain inline SVG polyline: no chart library for
 * one line and thirty points. Accessible summary in the title.
 */
export function Trend({ points }: Props) {
  if (points.length < 2) {
    return <p className="text-sm text-gray-500">Two or more runs and a trend appears here.</p>
  }
  const max = Math.max(...points.map((p) => p.wpm), 1)
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD)
  const y = (wpm: number) => H - PAD - (wpm / max) * (H - 2 * PAD)
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.wpm).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-40 w-full max-w-3xl"
      role="img"
      aria-label={`WPM over the last ${points.length} runs, latest ${last.wpm}`}
      data-testid="trend"
    >
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="stroke-gray-300" />
      <text x={PAD} y={PAD - 8} className="fill-gray-500 text-[11px]">
        {max} wpm
      </text>
      <polyline points={path} fill="none" className="stroke-blue-500" strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.wpm)} r={3} className="fill-blue-500">
          <title>{`${p.wpm} wpm · ${p.accuracy}% · ${p.language} ${p.mode}`}</title>
        </circle>
      ))}
    </svg>
  )
}
