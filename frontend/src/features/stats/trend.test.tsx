import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TrendPoint } from '../../lib/api'
import { movingAverage } from './movingAverage'
import { Trend } from './Trend'

const point = (wpm: number): TrendPoint => ({
  started_at: '2026-09-29T10:00:00Z',
  language: 'en',
  mode: 'practice',
  wpm,
  accuracy: 97,
})

describe('moving average', () => {
  it('averages the last seven runs, and says nothing before there are seven', () => {
    const avg = movingAverage([10, 20, 30, 40, 50, 60, 70, 80])
    expect(avg.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(avg[6]).toBe(40) // 10..70
    expect(avg[7]).toBe(50) // 20..80
  })
})

describe('speed chart', () => {
  it('draws the 7-run average over the runs, with labelled axes and a key', () => {
    render(<Trend points={[40, 42, 38, 45, 50, 48, 52, 55].map(point)} />)

    const chart = screen.getByTestId('trend')
    expect(chart).toHaveAttribute('aria-label', 'WPM over the last 8 runs, latest 55')
    expect(chart).toHaveTextContent('WPM')
    expect(chart).toHaveTextContent('oldest')
    expect(chart).toHaveTextContent('latest')
    expect(chart.querySelectorAll('circle')).toHaveLength(8)
    // Two averages exist for eight runs (runs 7 and 8): a line of two points.
    expect(screen.getByTestId('trend-average').getAttribute('points')?.split(' ')).toHaveLength(2)
    expect(screen.getByTestId('trend-average-now')).toHaveTextContent('7-run average, now 47.1 wpm')
  })

  it('says when the average will appear instead of drawing a shorter one', () => {
    render(<Trend points={[40, 42, 38].map(point)} />)

    expect(screen.queryByTestId('trend-average')).not.toBeInTheDocument()
    expect(screen.getByTestId('trend-average-now')).toHaveTextContent('from your 7th run (4 to go)')
  })

  it('waits for a second run before drawing anything', () => {
    render(<Trend points={[point(40)]} />)

    expect(screen.queryByTestId('trend')).not.toBeInTheDocument()
    expect(screen.getByText(/After your second counted run/)).toBeInTheDocument()
  })
})
