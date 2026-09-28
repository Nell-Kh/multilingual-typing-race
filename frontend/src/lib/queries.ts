// Shared query definitions (ADR-021).
//
// A TanStack Query key is a cache address: every component that uses the same key
// reads the same cached value. So the key and the *shape* stored under it have to be
// decided in one place, or two pages can disagree about what is in the cache — which
// is exactly how the daily challenge crashed (the home card cached the whole `Daily`
// envelope under ['daily', lang]; the practice page read that key expecting the inner
// `Text`). Anything used by more than one component belongs here.

import { queryOptions } from '@tanstack/react-query'
import { daily, leaderboards, stats, type Daily, type Language, type Text } from './api'

/**
 * Today's challenge for one language, cached exactly as the server sends it.
 *
 * `staleTime: Infinity` because the text is fixed for the whole day, midnight to midnight
 * Israel time (ADR-030): without it a window-focus refetch could swap the text out from
 * under someone mid-run.
 */
export function dailyQuery(language: Language) {
  return queryOptions({
    queryKey: ['daily', language] as const,
    queryFn: () => daily.get(language),
    staleTime: Infinity,
    retry: false,
  })
}

/** Consumers that only want the text select it out; the cache still holds `Daily`. */
export const selectDailyText = (d: Daily): Text => d.text

/** The signed-in user's per-language stats: the stats page and the home page's best row. */
export function myStatsQuery() {
  return queryOptions({ queryKey: ['me', 'stats'] as const, queryFn: stats.me })
}

/**
 * Today's board for one language. `me` is the signed-in player's best counted run
 * today, which is what "already done today" means on the home page.
 */
export function dailyBoardQuery(language: Language) {
  return queryOptions({
    queryKey: ['daily', 'board', language] as const,
    queryFn: () => leaderboards.daily(language),
    retry: false,
  })
}
