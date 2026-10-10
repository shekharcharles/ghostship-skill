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
  return Number.isFinite(at) ? span(at - nowMs) : null
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

// $ per million tokens: [cache read, 1h cache write, output], list prices September 2026, after cache-tax (MIT,
// github.com/karanb192/cache-tax). Longer names first: a model id takes the first row it contains.
const PRICES: [string, number, number, number][] = [
  ['fable-5-1', 0.25, 20, 50],
  ['fable-5', 1, 20, 50],
  ['opus-5', 0.5, 10, 25],
  ['opus-4', 0.5, 10, 25],
  ['sonnet-5', 0.2, 4, 10],
  ['sonnet', 0.3, 6, 15],
  ['haiku', 0.1, 2, 5],
]

/** The model's price row, [read, write, output] per MTok, the write at the cache's own lifetime (5m writes cost 1.25x base, 1h 2x). */
export function priceOf(model: string | null, ttl: number): [number, number, number] | null {
  const m = (model ?? '').toLowerCase().replace(/[\s.]+/g, '-')
  const row = PRICES.find(([name]) => m.includes(name))
  return row ? [row[1], ttl > 5 * 60_000 ? row[2] : row[2] * 0.625, row[3]] : null
}

/** What re-caching a context costs once the cache is cold: every token written again. */
export function coldWriteUsd(model: string | null, tokens: number | undefined, ttl: number): number | null {
  const p = priceOf(model, ttl)
  return p && tokens ? (tokens * p[1]) / 1e6 : null
}

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** What a call cost at list price: cache read, cache write, uncached input (the base rate, which the write rate is a multiple of), output. */
export function usageUsd(u: Usage, model: string | null, ttl: number): number | null {
  const p = priceOf(model, ttl)
  if (!p) return null
  const base = p[1] / (ttl > 5 * 60_000 ? 2 : 1.25)
  return (u.cache_read_input_tokens * p[0] + u.cache_creation_input_tokens * p[1] + u.input_tokens * base + u.output_tokens * p[2]) / 1e6
}

/**
 * What a refresh found: warm when it read the cached prefix and wrote under a tenth of that (only its own question);
 * otherwise the cache had already gone and the refresh wrote it again.
 */
export function refreshVerdict(u: Usage, model: string | null, ttl: number): { warm: boolean; read: number; write: number; usd: number | null } {
  const read = u.cache_read_input_tokens
  const write = u.cache_creation_input_tokens
  return { warm: read > 0 && write < 0.1 * read, read, write, usd: usageUsd(u, model, ttl) }
}

/** One agent's spend this session: the main thread ('main') or a subagent, its tokens and list-price cost so far. */
export type AgentSpend = {
  id: string; name: string; model: string | null; running: boolean; startMs: number; endMs: number | null
  input: number; output: number; steps: number; usd: number
}

/** The ledger with one more step of an agent added: tokens in (uncached, cache read and cache write together), out, its cost. */
export function addStep(list: readonly AgentSpend[], step: { id: string; name: string; model: string | null; usage: Usage; usd: number | null; nowMs: number }): AgentSpend[] {
  const u = step.usage
  const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const had = list.find(a => a.id === step.id)
  const next: AgentSpend = had
    ? { ...had, name: step.name === 'Agent' ? had.name : step.name, model: step.model ?? had.model, input: had.input + input, output: had.output + u.output_tokens, steps: had.steps + 1, usd: had.usd + (step.usd ?? 0) }
    : { id: step.id, name: step.name, model: step.model, running: step.id !== 'main', startMs: step.nowMs, endMs: null, input, output: u.output_tokens, steps: 1, usd: step.usd ?? 0 }
  return had ? list.map(a => (a.id === step.id ? next : a)) : [...list, next]
}

/** The ledger with an agent marked stopped. */
export function endAgent(list: readonly AgentSpend[], id: string, nowMs: number): AgentSpend[] {
  return list.map(a => (a.id === id && a.running ? { ...a, running: false, endMs: nowMs } : a))
}

/** The project's spend: every session's cost, as stored by session id. */
export function projectTotal(bySession: Record<string, number> | undefined): number {
  return Object.values(bySession ?? {}).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
}

/**
 * The session's spend split by agent and by model. The ledger's per-step cost is a list-price estimate that double-counts a
 * warm cache (each step re-reads the same context), so when Claude Code reports the real session total the shares are scaled
 * to it: the proportions hold, the totals stay honest. Without a real total the raw estimate stands.
 */
export function splitSpend(ledger: readonly AgentSpend[], sessionUsd: number | null): {
  session: number; main: number; subagents: number; byModel: [string, number][]; estimated: boolean
} {
  const est = ledger.reduce((s, a) => s + a.usd, 0)
  const scale = sessionUsd !== null && est > 0 ? sessionUsd / est : 1
  const at = (usd: number) => usd * scale
  const main = at(ledger.find(a => a.id === 'main')?.usd ?? 0)
  const byModel = new Map<string, number>()
  for (const a of ledger) if (a.usd > 0) byModel.set(a.model ?? 'unknown', (byModel.get(a.model ?? 'unknown') ?? 0) + at(a.usd))
  return { session: sessionUsd ?? est, main, subagents: at(est) - main, byModel: [...byModel], estimated: sessionUsd === null }
}

/** How long before the cache goes cold a keep-warm refresh is sent: a sixth of its lifetime (10m of 1h), at least 30 s. */
export function keepWarmLead(ttl: number): number {
  return Math.max(30_000, ttl / 6)
}

/** Whether keep-warm refreshes now: its window is open, no turn runs, and the cache is still warm but close to cold. */
export function keepWarmDue(d: { nowMs: number; until: number; left: number | null; ttl: number; working: boolean }): boolean {
  return d.until > d.nowMs && !d.working && d.left !== null && d.left > 0 && d.left <= keepWarmLead(d.ttl)
}

/** A duration at a glance: 5h 10m, 9m. */
export function span(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
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
  coldUsd?: number | null      // what the next send re-caches once cold
  keepWarmLeftMs?: number      // the keep-warm window still open
  projectUsd?: number | null   // every session of this project together
}): Part[] {
  const parts: Part[] = []
  const model = modelLabel(d.model)
  if (model) parts.push({ text: model, tone: 'model' })
  // The project's spend leads, so a narrow band keeps it: every session of this project, and this one.
  if (d.projectUsd != null) parts.push({ text: `project $${d.projectUsd.toFixed(2)}${d.usd !== null ? ` (session $${d.usd.toFixed(2)})` : ''}`, tone: 'model' })
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
        ? { text: `⏳ cold${d.coldUsd ? ` · next send ≈ $${d.coldUsd.toFixed(2)}` : ''}`, tone: 'bad' }
        : { text: `⏳ ${cacheShort(d.cacheLeftMs)}`, tone: d.cacheLeftMs <= d.leadMs ? 'warn' : 'ok' })
  if (d.keepWarmLeftMs && d.keepWarmLeftMs > 0) parts.push({ text: `♨ kept warm ${span(d.keepWarmLeftMs)}`, tone: 'ok' })
  if (d.hitPct !== null) parts.push({ text: `${d.hitPct}% hit`, tone: d.hitPct >= 50 ? 'ok' : 'warn' })
  if (d.projectUsd == null && d.usd !== null) parts.push({ text: `$${d.usd.toFixed(2)}`, tone: 'dim' })
  return parts
}
