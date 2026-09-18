import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { KeyAggregate } from '../../lib/api'
import { Heatmap } from './Heatmap'
import { charsOnLayout } from './layouts'

const key = (k: string, correct: number, errors: number): KeyAggregate => ({
  key: k,
  correct,
  errors,
  error_rate: correct + errors ? errors / (correct + errors) : 0,
  avg_latency_ms: 150,
})

describe('keyboard heatmap', () => {
  it('colours a key by its error rate and leaves untyped keys neutral', () => {
    render(
      <Heatmap
        language="en"
        keys={[key('a', 90, 10), key('s', 100, 0), key(' ', 50, 0)]}
      />,
    )

    const a = screen.getByTestId('key-a')
    expect(a).toHaveAttribute('data-error-rate', '0.1000')
    expect(a.className).toContain('bg-red-400') // 10%+ bin
    expect(screen.getByTestId('key-s').className).toContain('bg-transparent') // clean: no fill
    expect(screen.getByTestId('key-z')).toHaveAttribute('data-error-rate', '') // never typed
    expect(screen.getByTestId('key-z').className).toContain('border-dashed')
    expect(a).toHaveAttribute('title', 'A: 10 missed of 100 (10%)')
  })

  it('sums the characters that share one key', () => {
    render(<Heatmap language="en" keys={[key('a', 40, 5), key('A', 10, 5)]} />)

    expect(screen.getByTestId('key-a')).toHaveAttribute('title', 'A: 10 missed of 60 (17%)')
  })

  it('renders the Hebrew and Arabic boards with their own layout names', () => {
    const { unmount } = render(<Heatmap language="he" keys={[key('ש', 10, 1)]} />)
    expect(screen.getByText(/SI-1452/)).toBeInTheDocument()
    expect(screen.getByTestId('key-ש')).toHaveAttribute('data-error-rate', '0.0909')
    unmount()

    render(<Heatmap language="ar" keys={[key('ا', 20, 0), key('أ', 5, 5)]} />)
    expect(screen.getByText(/Arabic 101/)).toBeInTheDocument()
    // ا and أ are the same physical key (shifted), so they share one cell.
    expect(screen.getByTestId('key-ا')).toHaveAttribute('title', 'ا أ: 5 missed of 30 (17%)')
  })

  it('lists characters that no key on the layout claims', () => {
    render(<Heatmap language="he" keys={[key('ש', 10, 1), key('(', 2, 3)]} />)

    expect(screen.getByTestId('stray-keys')).toHaveTextContent('( ×5') // 2 correct + 3 missed
  })

  it('says so when there is nothing to show', () => {
    render(<Heatmap language="en" keys={[]} />)

    expect(screen.getByText(/No counted runs in this language yet/)).toBeInTheDocument()
    expect(screen.queryByTestId('heatmap')).not.toBeInTheDocument()
  })

  it('every layout claims the space bar and its own letters', () => {
    expect(charsOnLayout('en').has(' ')).toBe(true)
    expect(charsOnLayout('he').has('ש')).toBe(true)
    expect(charsOnLayout('ar').has('ط')).toBe(true)
    // Every Arabic letter has a home, so real Arabic typing never spills into
    // the "not on this layout" row.
    for (const letter of 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي') {
      expect(charsOnLayout('ar').has(letter)).toBe(true)
    }
    for (const letter of 'אבגדהוזחטיכךלמםנןסעפףצץקרשת') {
      expect(charsOnLayout('he').has(letter)).toBe(true)
    }
  })
})
