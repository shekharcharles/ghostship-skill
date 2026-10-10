// Pure helpers for the Ghostship mod: the voyage model and the parsers for the skill's own files
// (docs/ghostship/STATE.md and BOARD.md). No hooks, no JSX — imported by register.tsx and by the tests.

export type StageKey = 'interview' | 'prd' | 'spec' | 'plan' | 'tasks' | 'build' | 'release' | 'done'

export const VOYAGE: { key: StageKey; label: string }[] = [
  { key: 'interview', label: 'Interview' },
  { key: 'prd', label: 'PRD' },
  { key: 'spec', label: 'Spec' },
  { key: 'plan', label: 'Plan' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'build', label: 'Build' },
  { key: 'release', label: 'Release' },
]

export const STOP_AFTER: Partial<Record<StageKey, string>> = {
  spec: 'STOP 1 — approve the spec',
  release: 'STOP 2 — approve the release',
}

export type GhostshipState = {
  stage: StageKey | null
  task: string | null
  autonomy: string | null
  mode: string | null
  awaiting: string | null
  phase: string | null
  builder: string | null
  judge: string | null
  red: string | null
  green: string | null
}

/** Parse docs/ghostship/STATE.md. Tolerant of spacing and order; an unknown stage → null. */
export function parseState(text: string): GhostshipState {
  const field = (name: string) => {
    const m = text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, 'im'))
    return m ? m[1].trim() : null
  }
  const rawStage = (field('stage') || '').toLowerCase()
  const stage = VOYAGE.some(s => s.key === rawStage) || rawStage === 'done' ? (rawStage as StageKey) : null
  return {
    stage,
    task: field('active task') || field('task'),
    // First word only: a STATE.md copied from the template keeps its `# …` comments after the value.
    autonomy: (field('autonomy') || '').split(/\s+/)[0]!.toLowerCase() || null,
    mode: (field('mode') || '').split(/\s+/)[0]!.toLowerCase() || null,
    awaiting: (field('awaiting') || '').toLowerCase() || null,
    phase: field('phase'),
    builder: field('builder'),
    judge: field('judge'),
    red: field('red'),
    green: field('green'),
  }
}

export type Task = { id: string; phase: string; status: string; label: string }

/** Parse docs/ghostship/BOARD.md: markdown table rows `| T001 | 1 | done | setup |` (Task|Phase|Status|Covers). */
export function parseBoard(text: string): Task[] {
  const out: Task[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\|\s*(T\d+)\s*\|\s*([^|]*?)\s*\|\s*([A-Za-z]+)\s*\|\s*([^|]*?)\s*\|/)
    if (m) out.push({ id: m[1], phase: m[2], status: m[3].toLowerCase(), label: m[4] })
  }
  return out
}

export type Verdict = { task: string; verdict: 'pass' | 'fail' | 'parked'; note: string }

/** Parse docs/ghostship/EVIDENCE.md: one line per judged task, `T005 · PASS · npm test → exit 0 · 2026-10-10`. */
export function parseEvidence(text: string): Verdict[] {
  const out: Verdict[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s+)?(T\d+)\s*·\s*(PASS|FAIL|PARKED)\b\s*(?:·\s*(.*))?$/i)
    if (m) out.push({ task: m[1]!, verdict: m[2]!.toLowerCase() as Verdict['verdict'], note: (m[3] ?? '').trim() })
  }
  return out
}

export function progressBar(done: number, total: number, width = 10): string {
  if (total <= 0) return ''
  const filled = Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

export function statusMark(status: string): { glyph: string; color: string; bold: boolean } {
  if (status === 'done' || status === 'merged') return { glyph: '✓', color: 'success', bold: false }
  if (status === 'building' || status === 'judging' || status === 'current') return { glyph: '◆', color: 'claude', bold: true }
  if (status === 'parked') return { glyph: '⚠', color: 'warning', bold: true }
  return { glyph: '○', color: 'subtle', bold: false }
}

export type StageState = 'd' | 'c' | 't'
export function curIndexOf(stage: StageKey | null): number {
  if (!stage) return 0
  return stage === 'done' ? VOYAGE.length : VOYAGE.findIndex(s => s.key === stage)
}
/** The seven stages tagged done | current | todo for the given stage. */
export function voyageOf(stage: StageKey | null): { key: StageKey; label: string; state: StageState }[] {
  const cur = curIndexOf(stage)
  return VOYAGE.map((s, i) => ({ ...s, state: i < cur ? 'd' : i === cur ? 'c' : 't' }))
}

/** Compare dotted versions: >0 if a is newer than b, <0 if older, 0 if equal. */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a || '0').split('.').map(Number)
  const pb = String(b || '0').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

/** STATE.md with one `key: value` line set: replaced in place when present, otherwise added after `stage:` (or at the end). */
export function setStateField(text: string, key: string, value: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.trim().toLowerCase().startsWith(`${key}:`))
  if (at >= 0) lines[at] = `${key}: ${value}`
  else {
    const stage = lines.findIndex(l => l.trim().toLowerCase().startsWith('stage:'))
    if (stage >= 0) lines.splice(stage + 1, 0, `${key}: ${value}`)
    else lines.splice(lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, `${key}: ${value}`)
  }
  return lines.join('\n')
}
