// The pure rules of the gate: how many tests ran, and whether a run is recorded. No imports, so tests load it directly.

/** How many tests a runner's output reports as run. 0 when none is recognised: an unknown runner never counts as a run. */
export function countTests(output) {
  const patterns = [/(\d+)\s+passed/i, /(\d+)\s+(?:\w+\s+)?passed\b/i, /Tests:\s+(?:\d+\s+failed,\s+)?(\d+)\s+passed/i, /(\d+)\s+pass\b/i, /ok\s+(\d+)\b/i, /^# pass (\d+)$/m]
  let best = 0
  for (const p of patterns) {
    const m = output.match(p)
    if (m) best = Math.max(best, Number(m[1]))
  }
  return best
}

/** The verdict for one run. A red run must fail; a green run must pass with at least one test and follow a recorded red. */
export function verdictOf({ phase, exitCode, tests, hasRed, hasGreen = false }) {
  if (phase === 'red') return exitCode !== 0 ? { ok: true } : { ok: false, code: 'red-passed', why: 'red run passed: a test that already passes proves nothing' }
  if (phase === 'green') {
    if (exitCode !== 0) return { ok: false, code: 'green-failed', why: `green run failed (exit ${exitCode})` }
    if (tests === 0) return { ok: false, code: 'zero-tests', why: 'green run executed zero tests: not a pass' }
    if (!hasRed) return { ok: false, code: 'no-red', why: 'no red run recorded before this green run' }
    return { ok: true }
  }
  if (phase === 'verify') {
    if (exitCode !== 0) return { ok: false, code: 'verify-failed', why: `verification failed (exit ${exitCode})` }
    if (tests === 0) return { ok: false, code: 'zero-checks', why: 'verification executed zero checks: not a pass' }
    if (!hasGreen) return { ok: false, code: 'no-green', why: 'no green run recorded before verification' }
    return { ok: true }
  }
  return { ok: false, code: 'unknown-phase', why: `unknown phase "${phase}"` }
}

/** The ledger's lines, parsed. A line that does not parse is skipped, and is reported as `damaged` so resume can say so. */
export function readLedger(text) {
  const entries = []
  let damaged = 0
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch { damaged += 1 }
  }
  return { entries, damaged }
}

/**
 * Where a resumed build stands, from the ledger alone: tasks with a recorded green are done and must not be re-dispatched;
 * tasks with only a recorded red resume at green; nothing else is trusted.
 */
export function resumePlan(entries) {
  const greens = new Set(entries.filter(e => e.phase === 'green' && e.recorded).map(e => e.task))
  const reds = new Set(entries.filter(e => e.phase === 'red' && e.recorded).map(e => e.task))
  const verified = [...greens].sort()
  const inProgress = [...reds].filter(t => !greens.has(t)).sort()
  return { verified, inProgress, refused: entries.filter(e => !e.recorded).length }
}

/** Whether the ledger holds a recorded green for a task: the only proof the board's done may rest on. */
export function ledgerProves(entries, task) {
  return entries.some(e => e.task === task && e.phase === 'green' && e.recorded)
}

/** How many attempts the builder gets before a fresh implementer, and how many before a ruling is required. */
export const FRESH_AFTER = 3
export const RULING_AFTER = 4

/** Failed attempts for a task: a green or verify run that did not pass. A red that passes is a refused record, not an attempt. */
export function failedAttempts(entries, task) {
  return entries.filter(e => e.task === task && !e.recorded && e.status !== 'unverified' && (e.phase === 'green' || e.phase === 'verify')).length
}

/** What the next run of a task may do: ok, whether it must be a fresh implementer, and whether it is refused until a ruling exists. */
export function nextAttempt(failed, hasRuling) {
  if (failed >= RULING_AFTER && !hasRuling) {
    return { ok: false, why: `${failed} failed attempts and no ruling: write "Ruling: <task> — what, why, cost if wrong" in DECISIONS.md before any more runs` }
  }
  if (failed >= FRESH_AFTER && failed < RULING_AFTER) {
    return { ok: true, fresh: true, note: 'fresh implementer on a stronger model: the builder has failed three times' }
  }
  return { ok: true, fresh: false }
}

/**
 * A check that could not run at all (the program is missing, not executable, or the process failed to start) is not a failed
 * product run and not a pass: it is `unverified`. Returns the reason, or null when the command ran.
 */
export function cannotRun({ exitCode, error }) {
  if (error) return `the command could not start: ${error}`
  if (exitCode === 126 || exitCode === 127) return `the command could not run (exit ${exitCode})`
  return null
}

/**
 * What blocks a release, read from the ledger: lines that do not parse (the record is damaged) and tasks whose latest run
 * is unverified with no later recorded run. Unknown is never a pass.
 */
export function releaseBlockers(text) {
  const blockers = []
  const latest = new Map()
  let damaged = 0
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { damaged += 1; continue }
    if (e.task) latest.set(`${e.task}:${e.phase}`, e)
  }
  if (damaged) blockers.push(`${damaged} damaged ledger line(s): the record cannot be read in full`)
  for (const [key, e] of latest) if (e.status === 'unverified') blockers.push(`${key.split(':')[0]}: ${key.split(':')[1]} was not verified (${e.reason ?? 'could not run'})`)
  return blockers
}

/** Paths that are tests: a test directory, a `.test.`/`.spec.` file, or a Python test module. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/

/** The paths in `git status --porcelain` output that are not tests: source changed before its repro. */
export function nonTestChanges(porcelain) {
  return String(porcelain ?? '')
    .split('\n')
    .filter(Boolean)
    .map(l => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(p => p && !TEST_PATH.test(p))
}

const squash = s => s.replace(/\s+/g, '')

/**
 * Assertions whose expected value is the same expression as the value under test (`expect(add(2,2)).toBe(add(2,2))`,
 * `assert f(x) == f(x)`): they pass by construction and prove nothing. Returns the lines that do.
 */
export function tautologies(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    const js = line.match(/expect\((.+?)\)\.(?:toBe|toEqual|toStrictEqual)\((.+?)\)\s*;?\s*$/)
    if (js && squash(js[1]) === squash(js[2]) && squash(js[1]).length > 0) hits.push({ line: i + 1, text: line.trim() })
    const py = line.match(/^\s*assert\s+(.+?)\s*==\s*(.+?)\s*$/)
    if (py && squash(py[1]) === squash(py[2])) hits.push({ line: i + 1, text: line.trim() })
  })
  return hits
}

/** Every refusal the gate can make, and the barrier that enforces it. A code with no barrier is open: the retro refuses the release. */
export const BARRIERS = {
  'red-passed': 'task-done refuses a red run that passes',
  'source-before-repro': 'task-done refuses a red run when source has changed',
  'no-red': 'task-done refuses a green with no earlier red',
  'zero-tests': 'task-done refuses a green that runs zero tests',
  'green-failed': 'task-done refuses a green run that fails',
  'tautology': 'task-done refuses a changed test that asserts a value against itself',
  'unverified': 'task-done records a command that could not run as not verified, and the release refuses it',
  'verify-failed': 'task-done refuses a verification that fails',
  'no-green': 'task-done refuses a verification with no green before it',
  'unknown-phase': 'task-done refuses a phase it does not know',
  'zero-checks': 'task-done refuses a verification that runs zero checks',
  'fix-loop': 'task-done and the mod refuse a fifth attempt without a ruling',
  'no-verifier': 'the mod refuses a verify from anyone but a verifier subagent',
  'plan-without-sitemap': 'the mod refuses plan.md until the sitemap exists',
  'done-without-proof': 'the mod refuses a board row marked done without red, green and verify in the ledger',
}

/** The repeated failure codes (two or more), each with its count and whether a barrier enforces it. */
export function repeatedFailures(records) {
  const counts = new Map()
  for (const r of records) if (r.code) counts.set(r.code, (counts.get(r.code) ?? 0) + 1)
  return [...counts].filter(([, n]) => n >= 2).map(([code, count]) => ({ code, count, open: !BARRIERS[code] }))
}

/** The retro as Markdown: each repeated failure, its count, and its barrier or OPEN. */
export function retroMarkdown(records) {
  const rows = repeatedFailures(records)
  const open = rows.filter(r => r.open)
  const lines = ['# Retro', '', 'Repeated refusals, each checked against its barrier. An OPEN line has no barrier: add one before release.', '']
  if (!rows.length) lines.push('No repeated failures.')
  for (const r of rows) lines.push(`- ${r.code} × ${r.count}: ${r.open ? 'OPEN, no barrier yet' : `barrier: ${BARRIERS[r.code]}`}`)
  lines.push('', `Open items: ${open.length}`, '')
  return lines.join('\n')
}
