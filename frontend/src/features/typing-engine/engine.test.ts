import { describe, expect, it } from 'vitest'
import { BACKSPACE, charStatuses, initialState, liveStats, reduce, type EngineState } from './engine'

function type(state: EngineState, value: string, at: number): EngineState {
  return reduce(state, { type: 'input', value, at })
}

describe('engine: keystroke log', () => {
  it('records each correct character with its expected char and relative time', () => {
    let s = initialState('cat')
    s = type(s, 'c', 1000)
    s = type(s, 'ca', 1150)
    s = type(s, 'cat', 1300)

    expect(s.keystrokes).toEqual([
      [0, 'c', 'c'],
      [150, 'a', 'a'],
      [300, 't', 't'],
    ])
    expect(s.startedAt).toBe(1000)
    expect(s.finished).toBe(true)
  })

  it('records a typo, a backspace, and the correction', () => {
    let s = initialState('cat')
    s = type(s, 'c', 0)
    s = type(s, 'cq', 100) // typo
    s = type(s, 'c', 200) // backspace
    s = type(s, 'ca', 300) // fixed

    expect(s.keystrokes).toEqual([
      [0, 'c', 'c'],
      [100, 'a', 'q'],
      [200, '', BACKSPACE],
      [300, 'a', 'a'],
    ])
    expect(s.typed).toBe('ca')
    expect(s.finished).toBe(false)
  })

  it('turns a multi-character delete into that many backspaces', () => {
    let s = initialState('hello')
    s = type(s, 'hel', 0)
    s = type(s, 'h', 500)

    expect(s.keystrokes.slice(3)).toEqual([
      [500, '', BACKSPACE],
      [500, '', BACKSPACE],
    ])
  })

  it('turns a multi-character add (paste) into one keystroke per char, same time', () => {
    let s = initialState('abc')
    s = type(s, 'abc', 700)

    expect(s.keystrokes).toEqual([
      [0, 'a', 'a'],
      [0, 'b', 'b'],
      [0, 'c', 'c'],
    ])
  })

  it('refuses to advance past a mistake until it is fixed', () => {
    let s = initialState('cat')
    s = type(s, 'cq', 0) // wrong second char: kept, logged
    s = type(s, 'cqt', 100) // trying to continue: ignored
    expect(s.typed).toBe('cq')
    expect(s.keystrokes).toHaveLength(2)

    s = type(s, 'c', 200) // backspace
    s = type(s, 'ca', 300)
    s = type(s, 'cat', 400)
    expect(s.finished).toBe(true)
    expect(s.keystrokes.map((k) => k[2])).toEqual(['c', 'q', BACKSPACE, 'a', 't'])
  })

  it('a pasted block with a mistake inside is cut at the mistake', () => {
    let s = initialState('abcdef')
    s = type(s, 'abXdef', 0)

    expect(s.typed).toBe('abX')
    expect(s.keystrokes).toHaveLength(3)
  })

  it('ignores characters beyond the end of the target', () => {
    let s = initialState('ab')
    s = type(s, 'abXYZ', 0)

    expect(s.typed).toBe('ab')
    expect(s.keystrokes).toHaveLength(2)
    expect(s.finished).toBe(true)
  })

  it('ignores input once finished', () => {
    let s = initialState('ab')
    s = type(s, 'ab', 0)
    const after = type(s, 'a', 100)

    expect(after).toBe(s)
  })

  it('ignores a change event that changes nothing', () => {
    let s = initialState('ab')
    s = type(s, 'a', 0)
    const same = type(s, 'a', 100)

    expect(same).toBe(s)
    expect(s.keystrokes).toHaveLength(1)
  })

  it('handles Hebrew and Arabic characters as single positions', () => {
    let s = initialState('שלום')
    s = type(s, 'ש', 0)
    s = type(s, 'של', 100)

    expect(s.keystrokes).toEqual([
      [0, 'ש', 'ש'],
      [100, 'ל', 'ל'],
    ])

    let a = initialState('مرحبا')
    a = type(a, 'مر', 0)
    expect(a.keystrokes.map((k) => k[1])).toEqual(['م', 'ر'])
  })

  it('reset starts over with a new target', () => {
    let s = initialState('ab')
    s = type(s, 'ab', 0)
    s = reduce(s, { type: 'reset', target: 'xyz' })

    expect(s).toEqual(initialState('xyz'))
  })
})

describe('engine: derived values', () => {
  it('charStatuses marks correct, incorrect, current and pending', () => {
    let s = initialState('abcd')
    s = type(s, 'ax', 0)

    expect(charStatuses(s)).toEqual(['correct', 'incorrect', 'current', 'pending'])
  })

  it('charStatuses on a finished text has no current', () => {
    let s = initialState('ab')
    s = type(s, 'ab', 0)

    expect(charStatuses(s)).toEqual(['correct', 'correct'])
  })

  it('liveStats before typing is zeros with 100% accuracy', () => {
    expect(liveStats(initialState('abc'), 5000)).toEqual({ elapsedMs: 0, wpm: 0, accuracy: 100, errors: 0 })
  })

  it('liveStats uses the backend formulas', () => {
    // 10 correct chars in 12 s → 2 words / 0.2 min = 10 WPM
    let s = initialState('abcdefghij')
    s = type(s, 'a', 0)
    s = type(s, 'abcdefghij', 12_000)

    const stats = liveStats(s, 99_999)
    expect(stats).toEqual({ elapsedMs: 12_000, wpm: 10, accuracy: 100, errors: 0 })
  })

  it('liveStats counts errors and excludes backspaces from accuracy', () => {
    let s = initialState('ab')
    s = type(s, 'x', 0)
    s = type(s, '', 100)
    s = type(s, 'ab', 200)

    const stats = liveStats(s, 200)
    expect(stats.errors).toBe(1)
    expect(stats.accuracy).toBe(66.7) // 2 correct of 3 typed chars
  })

  it('liveStats keeps ticking while unfinished, freezes when finished', () => {
    let s = initialState('ab')
    s = type(s, 'a', 0)
    expect(liveStats(s, 4000).elapsedMs).toBe(4000)

    s = type(s, 'ab', 1000)
    expect(liveStats(s, 4000).elapsedMs).toBe(1000)
  })
})
