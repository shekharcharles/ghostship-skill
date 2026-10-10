// The band's usage line: the model, how full the context is, the 5-hour and weekly limits, the prompt-cache countdown and
// hit rate, and what the session has cost. Pure, so tests run it without an engine.

export type Tone = 'dim' | 'warn' | 'bad' | 'ok' | 'model'
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

/** The cache's time left at a glance: whole minutes from ten minutes up (43m), m:ss below, so the last ones tick. */
export function cacheShort(ms: number): string {
  return ms >= 10 * 60_000 ? `${Math.floor(ms / 60_000)}m` : countdown(ms)
}

/** A span until a time, as "1h 9m" or "9m". */
export function untilReset(resetsAt: string | undefined, nowMs: number): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(at)) return null
  const mins = Math.max(0, Math.round((at - nowMs) / 60_000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
}

/** The 5-hour and weekly windows' use and when the 5-hour one resets; null where there is no reading yet. */
export function limitsOf(list: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): {
  fiveHour: number | null; fiveHourResetsAt?: string; week: number | null
} {
  const five = list.find(l => l.kind === 'five_hour')
  return { fiveHour: five?.percentUsed ?? null, fiveHourResetsAt: five?.resetsAt, week: list.find(l => l.kind === 'seven_day')?.percentUsed ?? null }
}

/** The model's id as people say it: claude-haiku-5-5 → Haiku 5.5. */
export function modelLabel(id: string | null): string | null {
  if (!id) return null
  const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

/** A token count at a glance: 950, 75.2k, 1M. */
export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** How much of a reply's input the prompt cache served, as a whole percent; null when there was no input. */
export function hitRate(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null): number | null {
  if (!u) return null
  const all = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return all > 0 ? Math.round((u.cache_read_input_tokens / all) * 100) : null
}

const toneOf = (pct: number): Tone => (pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'ok')

/** A bar for the context fill. */
export function bar(pct: number, width = 16): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

/** Whether to warn now: the cache is still warm, a minute or less is left, and this reply's countdown has not warned yet. */
export function shouldWarn(left: number | null, leadMs: number, warnedFor: number, lastReplyAt: number): boolean {
  return left !== null && left > 0 && left <= leadMs && warnedFor !== lastReplyAt
}

/**
 * The line, most important first so a narrow band cuts the least: the model, the context bar and fill, the 5-hour use
 * and its reset, the weekly use, the cache countdown and hit rate, the session's cost.
 */
export function rowParts(d: {
  model: string | null
  contextPct: number | null
  tokens?: number
  window?: number
  working: boolean
  cacheLeftMs: number | null
  leadMs: number
  fiveHour: number | null
  fiveHourResetsAt?: string
  week: number | null
  hitPct: number | null
  usd: number | null
  nowMs: number
}): Part[] {
  const parts: Part[] = []
  const model = modelLabel(d.model)
  if (model) parts.push({ text: model, tone: 'model' })
  if (d.contextPct === null) parts.push({ text: 'ctx —', tone: 'dim' })
  else {
    parts.push({ text: `${bar(d.contextPct)} ${Math.round(d.contextPct)}%`, tone: toneOf(d.contextPct) })
    if (d.tokens !== undefined && d.window) parts.push({ text: `${fmtK(d.tokens)}/${fmtK(d.window)}`, tone: 'dim' })
  }
  if (d.fiveHour === null) parts.push({ text: '5h —', tone: 'dim' })
  else {
    const reset = untilReset(d.fiveHourResetsAt, d.nowMs)
    parts.push({ text: `5h ${Math.round(d.fiveHour)}%${reset ? ` · resets ${reset}` : ''}`, tone: toneOf(d.fiveHour) })
  }
  if (d.week !== null) parts.push({ text: `week ${Math.round(d.week)}%`, tone: toneOf(d.week) })
  parts.push(d.working
    ? { text: '⏳ warm', tone: 'ok' }
    : d.cacheLeftMs === null
      ? { text: '⏳ —', tone: 'dim' }
      : d.cacheLeftMs <= 0
        ? { text: '⏳ cold', tone: 'bad' }
        : { text: `⏳ ${cacheShort(d.cacheLeftMs)}`, tone: d.cacheLeftMs <= d.leadMs ? 'warn' : 'ok' })
  if (d.hitPct !== null) parts.push({ text: `${d.hitPct}% hit`, tone: d.hitPct >= 50 ? 'ok' : 'warn' })
  if (d.usd !== null) parts.push({ text: `$${d.usd.toFixed(2)}`, tone: 'dim' })
  return parts
}
