// The band's usage line: context fill, the prompt-cache countdown, the 5-hour and weekly limits. Pure, so tests run it
// without an engine.

export type Tone = 'dim' | 'warn' | 'bad'
export type Part = { text: string; tone: Tone }

/** The cache lifetime the setting names, in ms. */
export function ttlMs(setting: string | undefined): number {
  return setting === '1h' ? 60 * 60_000 : 5 * 60_000
}

/** Ms until the prompt cache goes cold: null before the first reply, 0 or less once cold. */
export function cacheLeft(nowMs: number, lastReplyAt: number, ttl: number): number | null {
  return lastReplyAt > 0 ? lastReplyAt + ttl - nowMs : null
}

/** A countdown as m:ss, or h:mm:ss past an hour. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The 5-hour and weekly windows' use, from the engine's rate-limit readings; null where there is no reading yet. */
export function limitsOf(list: readonly { kind: string; percentUsed: number }[]): { fiveHour: number | null; week: number | null } {
  const of = (kind: string) => list.find(l => l.kind === kind)?.percentUsed ?? null
  return { fiveHour: of('five_hour'), week: of('seven_day') }
}

const toneOf = (pct: number): Tone => (pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'dim')

/** An 8-cell bar for the context fill. */
export function bar(pct: number, width = 8): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
  return `▕${'█'.repeat(filled)}${'░'.repeat(width - filled)}▏`
}

/** Whether to warn now: the cache is still warm, a minute or less is left, and this reply's countdown has not warned yet. */
export function shouldWarn(left: number | null, leadMs: number, warnedFor: number, lastReplyAt: number): boolean {
  return left !== null && left > 0 && left <= leadMs && warnedFor !== lastReplyAt
}

/** The row: context fill, the cache countdown, the 5-hour and weekly limits, each with the tone it is drawn in. */
export function rowParts(d: {
  contextPct: number | null
  working: boolean
  cacheLeftMs: number | null
  leadMs: number
  fiveHour: number | null
  week: number | null
}): Part[] {
  const cache: Part = d.working
    ? { text: 'cache warm', tone: 'dim' }
    : d.cacheLeftMs === null
      ? { text: 'cache —', tone: 'dim' }
      : d.cacheLeftMs <= 0
        ? { text: 'cache cold', tone: 'bad' }
        : { text: `cache ${countdown(d.cacheLeftMs)}`, tone: d.cacheLeftMs <= d.leadMs ? 'warn' : 'dim' }
  const pct = (label: string, v: number | null): Part =>
    v === null ? { text: `${label} —`, tone: 'dim' } : { text: `${label} ${Math.round(v)}%`, tone: toneOf(v) }
  return [
    d.contextPct === null
      ? { text: 'ctx —', tone: 'dim' }
      : { text: `ctx ${Math.round(d.contextPct)}% ${bar(d.contextPct)}`, tone: toneOf(d.contextPct) },
    cache,
    pct('5h', d.fiveHour),
    pct('week', d.week),
  ]
}
