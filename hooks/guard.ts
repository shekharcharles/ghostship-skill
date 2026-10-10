// Commands the unattended build refuses to run, so the engine never stops to ask about them. Pure, so tests run it without an engine.

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
