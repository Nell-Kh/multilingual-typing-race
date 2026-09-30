import { describe, expect, it } from 'vitest'
import type { CharStatus } from './engine'
import { joins, joiningType, segments, ZWJ } from './segments'

const run = (text: string, typed: number, wrongAt?: number) => {
  const chars = Array.from(text)
  const statuses: CharStatus[] = chars.map((_, i) =>
    i === wrongAt ? 'incorrect' : i < typed ? 'correct' : i === typed ? 'current' : 'pending',
  )
  return segments(chars, statuses, typed < chars.length ? typed : null)
}

describe('Arabic joining types', () => {
  it('knows which letters connect on which side', () => {
    expect(joiningType('ب')).toBe('dual')
    expect(joiningType('ي')).toBe('dual')
    expect(joiningType('ى')).toBe('dual') // alef maqsura joins both ways
    for (const ch of 'اأإآدذرزوؤة') expect(joiningType(ch)).toBe('right')
    expect(joiningType('ء')).toBe('none')
    for (const ch of 'aש .،') expect(joiningType(ch)).toBe('none')
  })

  it('a pair joins only when the first reaches forward and the second reaches back', () => {
    expect(joins('ب', 'ا')).toBe(true)
    expect(joins('ل', 'م')).toBe(true)
    expect(joins('ا', 'ب')).toBe(false) // alef never connects to what follows
    expect(joins('د', 'ر')).toBe(false)
    expect(joins('ب', ' ')).toBe(false)
    expect(joins('ש', 'ל')).toBe(false) // Hebrew does not join
  })
})

describe('segments', () => {
  it('runs letters with the same status together: at most four spans in a line', () => {
    const segs = run('يغادر القطار في السابعة.', 10, 9)
    expect(segs.map((s) => s.status)).toEqual(['correct', 'incorrect', 'current', 'pending'])
    expect(segs[2].caret).toBe(true)
  })

  it('puts a joiner on both sides of a break between two connecting letters, and nowhere else', () => {
    // ق | ط (wrong) | ا (caret) | ر ...: ق→ط connect, ط→ا connect, ا→ر do not.
    const segs = run('يغادر القطار في السابعة.', 10, 9)
    expect(segs[0].text.endsWith('ق' + ZWJ)).toBe(true)
    expect(segs[1].text).toBe(ZWJ + 'ط' + ZWJ)
    expect(segs[2].text).toBe(ZWJ + 'ا')
    expect(segs[3].text.startsWith('ر')).toBe(true)
  })

  it('never changes the text itself: take the joiners out and it is the target', () => {
    for (const [text, typed, wrong] of [
      ['يغادر القطار في السابعة.', 10, 9],
      ['مرحبا بكم', 3, undefined],
      ['הרכבת יוצאת בשבע.', 6, undefined],
      ['The train leaves at seven.', 11, 10],
    ] as const) {
      const joined = run(text, typed, wrong).map((s) => s.text).join('')
      expect(joined.replaceAll(ZWJ, '')).toBe(text)
    }
  })

  it('adds nothing to Hebrew or English, which do not join', () => {
    for (const text of ['הרכבת יוצאת בשבע.', 'The train leaves at seven.']) {
      expect(run(text, 5, 4).some((s) => s.text.includes(ZWJ))).toBe(false)
    }
  })
})
