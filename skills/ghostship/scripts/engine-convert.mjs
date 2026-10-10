// The engine edition's project state (.ghostship/state/state.json) as this plugin's files (docs/ghostship/*.md).
// Pure: text in, text out, so tests run it without a file system. from-engine.mjs reads and writes the files.

const STAGES = { interview: 'interview', init: 'interview', adopt: 'interview', prd: 'prd', design: 'spec', acceptance: 'spec', spec: 'spec', plan: 'tasks', tasks: 'tasks', build: 'build', release: 'release', done: 'done', released: 'done' }
const STATUS = { TODO: 'todo', READY: 'todo', BUILDING: 'building', JUDGING: 'judging', REVIEW: 'judging', MERGED: 'done', DONE: 'done' }
const GONE = new Set(['RETIRED', 'PARKED', 'BLOCKED', 'DROPPED'])

const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
const phaseOf = p => String(p ?? '').match(/^\d+/)?.[0] ?? cell(p)

/** The autonomy the engine's config.yaml names (`autonomy:` then `mode:`), as this plugin's autopilot | auto. */
export function autonomyOf(configText) {
  const m = String(configText ?? '').match(/^autonomy:\s*\n(?:[ \t]+.*\n)*?[ \t]+mode:\s*(\w+)/m)
  return m && m[1] === 'auto' ? 'auto' : 'autopilot'
}

/**
 * The files: STATE.md, BOARD.md, EVIDENCE.md, DECISIONS.md (when a dropped task holds others back), and the report lines.
 * A task the owner retired or parked stays parked; the tasks waiting on it are parked too, with one decision per such task
 * (cut the link and build them, or drop them), so the build never stops to ask and STOP 2 asks it with the rest.
 */
export function convert(state, configText) {
  const tasks = Object.values(state.tasks ?? {})
  const gone = new Map(tasks.filter(t => GONE.has(String(t.status).toUpperCase())).map(t => [t.id, String(t.status).toLowerCase()]))
  const waiting = new Map()
  for (const t of tasks) {
    const status = String(t.status).toUpperCase()
    if (GONE.has(status) || STATUS[status] === 'done') continue
    const held = (t.blockedBy ?? []).filter(d => gone.has(d))
    for (const d of held) waiting.set(d, [...(waiting.get(d) ?? []), t.id])
  }
  // Waiting tasks are parked, and so is whatever waits on them, so nothing is built on a missing piece.
  const parked = new Map([...gone].map(([id, why]) => [id, why]))
  let grew = true
  while (grew) {
    grew = false
    for (const t of tasks) {
      if (parked.has(t.id) || STATUS[String(t.status).toUpperCase()] === 'done') continue
      const by = (t.blockedBy ?? []).find(d => parked.has(d))
      if (by) { parked.set(t.id, `blocked by ${by}`); grew = true }
    }
  }

  const statusOf = t => (parked.has(t.id) ? 'parked' : STATUS[String(t.status).toUpperCase()] ?? String(t.status).toLowerCase())
  const board = [
    '# Board', '', '| Task | Phase | Status | Covers |', '|------|-------|--------|--------|',
    ...tasks.map(t => `| ${t.id} | ${phaseOf(t.phase)} | ${statusOf(t)} | ${cell(t.title)}${parked.has(t.id) ? ` (${parked.get(t.id)})` : ''} |`),
    '',
  ].join('\n')

  const active = tasks.find(t => ['building', 'judging'].includes(statusOf(t)))
  const done = tasks.filter(t => statusOf(t) === 'done').length
  const stage = STAGES[String(state.stage ?? '').toLowerCase()] ?? 'interview'
  const lines = [
    `stage: ${stage}`,
    active ? `phase: ${phaseOf(active.phase)}` : null,
    `autonomy: ${autonomyOf(configText)}`,
    'mode: tdd',
    active ? `active task: ${active.id}` : null,
    state.prd?.path ? `prd: ${state.prd.path}${state.prd.approved ? ' (approved)' : ''}` : null,
    state.design?.files?.length ? `design: docs/02-design/ (${state.design.files.join(', ')})` : null,
    state.acceptance?.path ? `spec: ${state.acceptance.path}${state.acceptance.approved ? ' (approved, STOP 1 passed)' : ''}` : null,
    'tasks: tasks/T###-*.md (from the engine edition)',
    `moved from: Ghostship engine edition, ${done}/${tasks.length} tasks done`,
  ].filter(Boolean)

  const evidence = [
    '# Evidence', '',
    ...tasks.filter(t => statusOf(t) === 'done').map(t => `- ${t.id} · PASS · merged in the engine edition`),
    ...tasks.filter(t => statusOf(t) === 'parked').map(t => `- ${t.id} · PARKED · ${parked.get(t.id)}`),
    '',
  ].join('\n')

  let n = 0
  const decisions = [...waiting].map(([id, ids]) => {
    n += 1
    const t = tasks.find(x => x.id === id)
    return [
      `## D${n} · ${id} was ${gone.get(id)}: ${ids.length} task${ids.length === 1 ? '' : 's'} wait${ids.length === 1 ? 's' : ''} on it`,
      `${id} (${cell(t?.title)}) will not be built, so ${ids.join(', ')} and what depends on them are parked.`,
      `- **Cut the ${id} link, keep the rest (Recommended):** remove ${id} from their prerequisites, drop any task that only served ${id}, and build the rest.`,
      `- **Drop the whole chain:** park them for good and release what is built.`,
      '',
    ].join('\n')
  })

  return {
    files: {
      'docs/ghostship/STATE.md': lines.join('\n') + '\n',
      'docs/ghostship/BOARD.md': board,
      'docs/ghostship/EVIDENCE.md': evidence,
      ...(decisions.length ? { 'docs/ghostship/DECISIONS.md': ['# Decisions', '', ...decisions].join('\n') } : {}),
    },
    report: `${tasks.length} tasks: ${done} done, ${[...parked.keys()].length} parked, ${tasks.length - done - parked.size} to build; stage ${stage}; ${decisions.length} decision${decisions.length === 1 ? '' : 's'} for STOP 2`,
  }
}

/** The project's .claude/settings.json without the engine's hooks and status line; null when nothing of the engine is there. */
export function unhook(settings) {
  const isEngine = h => /\.ghostship\/core\/runtime/.test(JSON.stringify(h))
  const out = { ...settings }
  let changed = false
  if (out.statusLine && isEngine(out.statusLine)) { delete out.statusLine; changed = true }
  if (out.hooks) {
    const hooks = {}
    for (const [event, groups] of Object.entries(out.hooks)) {
      const kept = (groups ?? []).map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isEngine(h)) })).filter(g => g.hooks.length)
      if (kept.length !== (groups ?? []).length || kept.some((g, i) => g.hooks.length !== groups[i].hooks.length)) changed = true
      if (kept.length) hooks[event] = kept
    }
    if (Object.keys(hooks).length) out.hooks = hooks
    else delete out.hooks
  }
  return changed ? out : null
}
