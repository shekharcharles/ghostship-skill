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

// The only owner stop is STOP 1 (approve the spec); release is automatic, so no stop marker there.
export const STOP_AFTER: Partial<Record<StageKey, string>> = {
  spec: 'STOP 1 — approve the spec',
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
  // The live proof's inputs, agreed at STOP 1: the environment variable that holds the AI provider's key (its name, never the value),
  // the lab's address, and the spend cap in dollars the build may not pass.
  providerEnv: string | null
  labUrl: string | null
  spendCapUsd: number | null
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
    // Only the variable's name: a note after it (`(value supplied by owner, not stored)`) is not part of it.
    providerEnv: ((field('provider env') || field('provider key variable') || '').match(/^[A-Z_][A-Z0-9_]*/)?.[0]) || null,
    // A lab is named by its address; a line saying it is not chosen names none.
    labUrl: field('lab url') || ((field('live lab') || '').match(/https?:\/\/\S+/)?.[0] ?? null),
    spendCapUsd: Number((field('spend cap') || '').replace(/[$,\s]/g, '')) || null,
  }
}

/** What is still missing before a live test can run: the provider's key, the lab and the spend cap. Empty when ready. */
export function missingForLive(st: GhostshipState, env: { hasKey: boolean; labOk: boolean | null }): string[] {
  const missing: string[] = []
  if (!st.providerEnv) missing.push('the AI provider (its key variable is not named in STATE.md)')
  else if (!env.hasKey) missing.push(`the key variable ${st.providerEnv} is not set`)
  if (!st.labUrl) missing.push('the lab to test against is not chosen')
  else if (env.labOk === false) missing.push(`the lab at ${st.labUrl} does not answer`)
  if (!st.spendCapUsd) missing.push('no spend cap is set')
  return missing
}

/** Whether the session has reached the spend cap the owner set; a cap of null never stops anything. */
export function capReached(spentUsd: number | null, cap: number | null): boolean {
  return spentUsd !== null && cap !== null && spentUsd >= cap
}

export type Task = { id: string; name: string; phase: string; status: string; label: string }

/** Parse docs/ghostship/BOARD.md: markdown table rows `| T001 | 1 | done | setup |` (Task|Phase|Status|Covers). */
export function parseBoard(text: string): Task[] {
  const out: Task[] = []
  // A board with a Name column (`| Task | Name | Phase | Status | Covers |`) names each task; an older one (`| Task | Phase | Status | Covers |`) has no name.
  let columns: string[] = []
  for (const line of text.split('\n')) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells[0] === 'Task') { columns = cells.map(c => c.toLowerCase()); continue }
    const m = line.match(/^\s*\|\s*(T\d+)\s*\|/)
    if (!m || !cells.length) continue
    const at = (name: string, fallback: number) => (columns.includes(name) ? cells[columns.indexOf(name)] ?? '' : cells[fallback] ?? '')
    const named = columns.includes('name')
    const status = (at('status', named ? 3 : 2)).toLowerCase()
    out.push({
      id: m[1],
      name: named ? at('name', 1) : '',
      phase: at('phase', named ? 2 : 1),
      status,
      label: at('covers', named ? 4 : 3),
    })
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

/**
 * Whether Ghostship is running unattended: past STOP 1 (plan, tasks, build or release) with no stop waiting on the owner.
 * In this window the owner is never asked; anything that needs them is parked, and release is automatic.
 */
export function isUnattended(st: GhostshipState | null): boolean {
  return !!st && (st.stage === 'plan' || st.stage === 'tasks' || st.stage === 'build' || st.stage === 'release') && !st.awaiting
}

/** The tasks still to finish: not done, merged or parked. */
export function remainingTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => !['done', 'merged', 'parked'].includes(t.status))
}

/** A task file's acceptance check: the line that names its gate command (`gate: …`, `Gate command: …`, `checks: …`), or null. */
export function gateOf(text: string): string | null {
  const m = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(gate(?: command)?|test command|checks?)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/im)
  const v = m?.[2]?.replace(/^`|`$/g, '').trim()
  return v && v !== '[]' ? v : null
}

/** Whether a verdict's note carries an end-to-end run (`e2e: <command> → <what it showed>`): the only proof that a feature is built. */
export function provenOf(note: string): boolean {
  return /\be2e\s*:\s*\S/i.test(note)
}

/** Whether a verdict's note shows red then green: `red: <command> → fail … · green: <command> → pass`. Test first, or it is not TDD. */
export function tddOf(note: string): boolean {
  const red = note.search(/\bred\s*:\s*\S/i)
  const green = note.search(/\bgreen\s*:\s*\S/i)
  return red >= 0 && green > red
}
