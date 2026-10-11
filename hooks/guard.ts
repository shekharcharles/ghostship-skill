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

