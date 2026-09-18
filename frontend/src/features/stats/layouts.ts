// Physical keyboard layouts for the heatmap: US QWERTY, Hebrew SI-1452, Arabic 101.
//
// A key lists every character it produces, because the per-key stats are keyed by
// the character that was typed ("a" and "A" are one key; so are "ا" and "أ").
// Mappings we are not certain of are deliberately left out rather than guessed:
// any character with data that no key claims is listed separately under the board,
// so the picture is never quietly wrong.

import type { Language } from '../../lib/api'

export interface KeyCap {
  /** What is printed on the cap. */
  label: string
  /** Characters this key produces; empty means "shown for shape, never has data". */
  chars: string[]
  /** Relative width, 1 = a letter key. */
  width?: number
}

const SPACE: KeyCap = { label: '␣', chars: [' '], width: 6 }

function row(pairs: [string, string][]): KeyCap[] {
  return pairs.map(([label, chars]) => ({ label, chars: [...chars] }))
}

const QWERTY: KeyCap[][] = [
  row([
    ['Q', 'qQ'], ['W', 'wW'], ['E', 'eE'], ['R', 'rR'], ['T', 'tT'], ['Y', 'yY'],
    ['U', 'uU'], ['I', 'iI'], ['O', 'oO'], ['P', 'pP'],
  ]),
  row([
    ['A', 'aA'], ['S', 'sS'], ['D', 'dD'], ['F', 'fF'], ['G', 'gG'], ['H', 'hH'],
    ['J', 'jJ'], ['K', 'kK'], ['L', 'lL'], [';:', ';:'], ["'\"", '\'"'],
  ]),
  row([
    ['Z', 'zZ'], ['X', 'xX'], ['C', 'cC'], ['V', 'vV'], ['B', 'bB'], ['N', 'nN'],
    ['M', 'mM'], [',<', ','], ['.>', '.'], ['/?', '/?'],
  ]),
  [SPACE],
]

// SI-1452. Hebrew has no case, so most keys produce exactly one character.
const HEBREW: KeyCap[][] = [
  row([
    ['/', '/'], ["'", "'"], ['ק', 'ק'], ['ר', 'ר'], ['א', 'א'], ['ט', 'ט'],
    ['ו', 'ו'], ['ן', 'ן'], ['ם', 'ם'], ['פ', 'פ'],
  ]),
  row([
    ['ש', 'ש'], ['ד', 'ד'], ['ג', 'ג'], ['כ', 'כ'], ['ע', 'ע'], ['י', 'י'],
    ['ח', 'ח'], ['ל', 'ל'], ['ך', 'ך'], ['ף', 'ף'], [',', ','],
  ]),
  row([
    ['ז', 'ז'], ['ס', 'ס'], ['ב', 'ב'], ['ה', 'ה'], ['נ', 'נ'], ['מ', 'מ'],
    ['צ', 'צ'], ['ת', 'ת'], ['ץ', 'ץ'], ['.', '.'],
  ]),
  [SPACE],
]

// Arabic 101, with the shifted characters our corpus actually uses (أ إ آ ، ؛ ؟).
const ARABIC: KeyCap[][] = [
  // ذ is the backtick key, physically at the left edge of the number row; it sits
  // at the start of this row so the board stays three rows tall. ج and د are the
  // [ and ] keys and close the row where they really are.
  row([
    ['ذ', 'ذ'], ['ض', 'ض'], ['ص', 'ص'], ['ث', 'ث'], ['ق', 'ق'], ['ف', 'ف'],
    ['غ إ', 'غإ'], ['ع', 'ع'], ['ه', 'ه'], ['خ', 'خ'], ['ح ؛', 'ح؛'],
    ['ج', 'ج'], ['د', 'د'],
  ]),
  row([
    ['ش', 'ش'], ['س', 'س'], ['ي', 'ي'], ['ب', 'ب'], ['ل', 'ل'], ['ا أ', 'اأ'],
    ['ت', 'ت'], ['ن ،', 'ن،'], ['م', 'م'], ['ك :', 'ك:'], ['ط "', 'ط"'],
  ]),
  row([
    ['ئ', 'ئ'], ['ء', 'ء'], ['ؤ', 'ؤ'], ['ر', 'ر'], ['لا', ''], ['ى آ', 'ىآ'],
    ['ة', 'ة'], ['و ,', 'و,'], ['ز .', 'ز.'], ['ظ ؟', 'ظ؟'],
  ]),
  [SPACE],
]

export const LAYOUTS: Record<Language, { name: string; rows: KeyCap[][] }> = {
  en: { name: 'US QWERTY', rows: QWERTY },
  he: { name: 'SI-1452', rows: HEBREW },
  ar: { name: 'Arabic 101', rows: ARABIC },
}

/** Every character any key on this layout claims. */
export function charsOnLayout(language: Language): Set<string> {
  const chars = new Set<string>()
  for (const keys of LAYOUTS[language].rows) {
    for (const key of keys) for (const c of key.chars) chars.add(c)
  }
  return chars
}
