// The build's subagents (builder, judge, any other) as rows under the band: what each is doing, in words.
// Pure helpers only, so tests can run them without an engine.

export type Running = { name: string; label: string; startMs: number }

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const base = (p: unknown): string => (typeof p === 'string' ? p.split('/').pop() || p : '')

/** A tool call in a few words: `Reading band.tsx`, or a command's own description. */
export function stepOf(tool: string, args: Record<string, unknown>): string {
  const str = (k: string): string => (typeof args[k] === 'string' ? clip((args[k] as string).replace(/\s+/g, ' ').trim(), 60) : '')
  switch (tool) {
    case 'Bash': return str('description') || (str('command') ? `Running ${str('command')}` : 'Running a command')
    case 'Read': return `Reading ${base(args.file_path)}`
    case 'Edit': return `Editing ${base(args.file_path)}`
    case 'Write': return `Writing ${base(args.file_path)}`
    case 'Grep': return `Searching for "${str('pattern')}"`
    case 'Glob': return `Finding ${str('pattern')}`
    default: return tool
  }
}

/** Builder and judge stand out by colour; any other subagent is plain. */
export function roleOf(name: string): 'builder' | 'judge' | 'other' {
  return /judge/i.test(name) ? 'judge' : /build/i.test(name) ? 'builder' : 'other'
}

/** How many subagent rows fit in `room` rows: the newest `shown`, plus a "… n more" row when some are left out. */
export function fitAgents(total: number, room: number, max: number): { shown: number; more: number } {
  const cap = Math.max(0, Math.min(max, room))
  if (total <= cap) return { shown: total, more: 0 }
  if (cap === 0) return { shown: 0, more: 0 }
  const shown = cap - 1
  return { shown, more: total - shown }
}
