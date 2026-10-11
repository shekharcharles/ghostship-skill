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
