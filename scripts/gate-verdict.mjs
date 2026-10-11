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
  if (phase === 'red') return exitCode !== 0 ? { ok: true } : { ok: false, why: 'red run passed: a test that already passes proves nothing' }
  if (phase === 'green') {
    if (exitCode !== 0) return { ok: false, why: `green run failed (exit ${exitCode})` }
    if (tests === 0) return { ok: false, why: 'green run executed zero tests: not a pass' }
    if (!hasRed) return { ok: false, why: 'no red run recorded before this green run' }
    return { ok: true }
  }
  if (phase === 'verify') {
    // The verifier runs the product (end to end), not the unit tests: it must pass, run something, and follow a recorded green.
    if (exitCode !== 0) return { ok: false, why: `verification failed (exit ${exitCode})` }
    if (tests === 0) return { ok: false, why: 'verification executed zero checks: not a pass' }
    if (!hasGreen) return { ok: false, why: 'no green run recorded before verification' }
    return { ok: true }
  }
  return { ok: false, why: `unknown phase "${phase}"` }
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
