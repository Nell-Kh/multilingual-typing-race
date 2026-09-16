import type { Language } from '../lib/api'

export type Direction = 'ltr' | 'rtl'

/** Everything the UI needs to know about a typing language, in one place. */
export const LANGUAGES: Record<Language, { label: string; dir: Direction }> = {
  en: { label: 'English', dir: 'ltr' },
  he: { label: 'עברית', dir: 'rtl' },
  ar: { label: 'العربية', dir: 'rtl' },
}

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[]

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in LANGUAGES
}

export function directionOf(language: Language): Direction {
  return LANGUAGES[language].dir
}

const STORAGE_KEY = 'practice.language'

/** The language the player last practised, or English on a fresh browser. */
export function loadPracticeLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // Storage can be unavailable (private mode, blocked); English is a fine default.
  }
  return 'en'
}

export function savePracticeLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Same as above: remembering the choice is a convenience, not a requirement.
  }
}
