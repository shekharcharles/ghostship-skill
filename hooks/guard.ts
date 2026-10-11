// Commands the unattended build refuses to run, so the engine never stops to ask about them. Pure, so tests run it without an engine.
import { parseEvidence, provenOf, tddOf } from './state.ts'

/**
 * A `rm` that can delete more than was named: recursive or forced, with a wildcard, a variable, the root, the home folder or a
 * parent or current folder as its target. Returns why it is refused, or null for a command that is fine.
 */
export function riskyDelete(command: string): string | null {
  for (const part of command.split(/&&|\|\||;|\||\n/)) {
    const m = part.trim().match(/^(?:sudo\s+)?rm\s+(.*)$/)
    if (!m) continue
    const args = m[1]!.split(/\s+/).filter(Boolean)
    const broad = args.some(a => /^-[a-zA-Z]*[rRf]/.test(a) || a === '--recursive' || a === '--force')
    if (!broad) continue
    for (const target of args.filter(a => !a.startsWith('-'))) {
      if (/[*?$`{]|^~|^\/+$|^\.{1,2}\/?$/.test(target)) {
        return `rm of "${target}" can remove more than you named`
      }
    }
  }
  return null
}

/** What the refusal tells the agent: the task goes on, with a named delete or a fresh folder instead. */
export const DELETE_REFUSED = 'Ghostship refused this delete because it can remove more than you named (a wildcard, a variable, or a root, home or parent folder). ' +
  'Delete the named files one by one, or work in a new empty folder. Carry on with the task; do not wait for an answer.'

/**
 * The tasks a board edit marks done (or merged) that have no proof: their latest PASS line in the evidence has no red run before
 * the green, or no end-to-end run. A task is done only with both, so a write that says otherwise is refused.
 */
export function unprovenDone(boardEdit: string, evidence: string): string[] {
  const done = [...boardEdit.matchAll(/^\s*\|\s*(T\d+)\s*\|[^\n]*\|\s*(?:done|merged)\s*\|/gim)].map(m => m[1]!)
  const verdicts = parseEvidence(evidence)
  return [...new Set(done)].filter(id => {
    const pass = verdicts.filter(v => v.task === id && v.verdict === 'pass').at(-1)
    return !pass || !tddOf(pass.note) || !provenOf(pass.note)
  })
}

export const DONE_NEEDS_PROOF = 'Ghostship: a task cannot be marked done until its evidence shows a red run (the failing test, first) and an end-to-end run. ' +
  'Record both in docs/ghostship/EVIDENCE.md for that task, then mark it done on the board.'

/** Whether a shell command tags or publishes a release: `git tag`, `gh release create`, `npm publish`. */
export function releaseCommand(command: string): boolean {
  return command.split(/&&|\|\||;|\||\n/).some(part => /^\s*(git\s+tag\b|gh\s+release\s+create\b|npm\s+publish\b)/.test(part))
}

export const RELEASE_NEEDS_PROOF = 'Ghostship: the release is not tagged while any task is not built. Build the tasks that are not proven ' +
  '(red, then green, then end to end) or mark them parked with the reason, then tag.'


/** Whether a board has any task rows. An empty board is no evidence that nothing is unbuilt, so the release gate refuses it. */
export function boardHasTasks(board: string): boolean {
  return /^\s*\|\s*T\d+\s*\|/m.test(board)
}

/** The tasks a board edit marks done that the ledger does not prove with a recorded green. The ledger is the record; EVIDENCE.md is a copy. */
export function doneNotInLedger(boardEdit: string, ledgerText: string): string[] {
  // Done needs a recorded red-then-green and a recorded verifier pass. (The verifier's pass is a ledger line with phase verify.)
  // The ledger's rules live in scripts/gate-verdict.mjs; the same parse runs in the mod and in the gate script.
  const greens = new Set<string>()
  const verified = new Set<string>()
  for (const line of ledgerText.split('\n')) {
    try {
      const e = JSON.parse(line) as { task?: string; phase?: string; recorded?: boolean }
      if (e.phase === 'green' && e.recorded && e.task) greens.add(e.task)
      if (e.phase === 'verify' && e.recorded && e.task) verified.add(e.task)
    } catch { /* skipped */ }
  }
  const done = [...boardEdit.matchAll(/^\s*\|\s*(T\d+)\s*\|[^\n]*\|\s*(?:done|merged)\s*\|/gim)].map(m => m[1]!)
  return [...new Set(done)].filter(id => !greens.has(id) || !verified.has(id))
}

/** Whether a path is the ledger: it is written only by the gate script, never by an edit. */
export function isLedgerPath(path: string): boolean {
  return path.endsWith('docs/ghostship/LEDGER.jsonl')
}

/** A resume's summary read from the ledger text: verified tasks stay verified, tasks with only a red resume at green. */
export function resumeFrom(ledgerText: string): { verified: number; inProgress: number; damaged: number } {
  const greens = new Set<string>()
  const reds = new Set<string>()
  let damaged = 0
  for (const line of ledgerText.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { task?: string; phase?: string; recorded?: boolean }
      if (e.recorded && e.task && e.phase === 'green') greens.add(e.task)
      if (e.recorded && e.task && e.phase === 'red') reds.add(e.task)
    } catch { damaged += 1 }
  }
  return { verified: greens.size, inProgress: [...reds].filter(t => !greens.has(t)).length, damaged }
}

/** Whether a shell command records a gate run. The orchestrator never does: only a subagent may, and only a verifier may verify. */
export function gateRecordCommand(command: string): { recordsRun: boolean; phase: string | null } {
  const m = command.match(/task-done\.mjs\s+(red|green|verify)\b/)
  return { recordsRun: !!m, phase: m ? m[1]! : null }
}

/**
 * The fix loop, as the mod sees it: a gate run for a task that has failed four times is refused until DECISIONS.md holds a ruling
 * for it. The count and the rule are the same as scripts/gate-verdict.mjs; the mod checks the command before it runs.
 */
export function fixLoopRefusal(command: string, ledgerText: string, decisionsText: string): string | null {
  const m = command.match(/task-done\.mjs\s+(red|green|verify)\s+(T\d+)\b/)
  if (!m) return null
  const task = m[2]!
  let failed = 0
  for (const line of ledgerText.split('\n')) {
    try {
      const e = JSON.parse(line) as { task?: string; phase?: string; recorded?: boolean }
      if (e.task === task && e.recorded === false && (e as { status?: string }).status !== 'unverified' && (e.phase === 'green' || e.phase === 'verify')) failed += 1
    } catch { /* skipped */ }
  }
  const ruled = decisionsText.includes(`Ruling: ${task}`)
  return failed >= 4 && !ruled ? `${task} has failed ${failed} times with no ruling: write "Ruling: ${task} — what, why, cost if wrong" in DECISIONS.md first` : null
}

/** The release blockers the mod can see: damaged ledger lines, and runs that could not be verified with no later recorded run. */
export function releaseBlockersOf(ledgerText: string): string[] {
  const blockers: string[] = []
  const latest = new Map<string, { status?: string; reason?: string; recorded?: boolean }>()
  let damaged = 0
  for (const line of ledgerText.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { task?: string; phase?: string; status?: string; reason?: string; recorded?: boolean }
      if (e.task) latest.set(`${e.task}:${e.phase}`, e)
    } catch { damaged += 1 }
  }
  if (damaged) blockers.push(`${damaged} damaged ledger line(s): the record cannot be read in full`)
  for (const [key, e] of latest) if (e.status === 'unverified') blockers.push(`${key.replace(':', ': ')} was not verified (${e.reason ?? 'could not run'})`)
  return blockers
}

