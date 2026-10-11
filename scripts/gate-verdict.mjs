// The pure rules of the gate: how many tests ran, and whether a run is recorded. No imports, so tests load it directly.

/** How many tests a runner's output reports as run. 0 when none is recognised: an unknown runner never counts as a run. */
export function countTests(output) {
  const patterns = [/(\d+)\s+passed/i, /Tests:\s+(?:\d+\s+failed,\s+)?(\d+)\s+passed/i, /(\d+)\s+pass\b/i, /ok\s+(\d+)\b/i, /^# pass (\d+)$/m]
  let best = 0
  for (const p of patterns) {
    const m = output.match(p)
    if (m) best = Math.max(best, Number(m[1]))
  }
  return best
}

/** The verdict for one run. A red run must fail; a green run must pass with at least one test and follow a recorded red. */
export function verdictOf({ phase, exitCode, tests, hasRed }) {
  if (phase === 'red') return exitCode !== 0 ? { ok: true } : { ok: false, why: 'red run passed: a test that already passes proves nothing' }
  if (phase === 'green') {
    if (exitCode !== 0) return { ok: false, why: `green run failed (exit ${exitCode})` }
    if (tests === 0) return { ok: false, why: 'green run executed zero tests: not a pass' }
    if (!hasRed) return { ok: false, why: 'no red run recorded before this green run' }
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
