import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  VOYAGE, STOP_AFTER, parseState, parseBoard, parseEvidence, setStateField, voyageOf, curIndexOf,
  progressBar, statusMark, cmpVersion, type GhostshipState, type Task,
} from './state.ts'
import type { VoyageSnap } from '../types'
import { bandTree } from './band.tsx'
import { GS, clock, fmtTokens } from './lib.ts'
import { appEntries, appIdentity } from './overview.ts'
import { fitAgents, roleOf, stepOf, type Running } from './agents.ts'

// Ghostship's two live surfaces: the band above the prompt (drawn by the hooks module on the terminal, one SVG on the
// desktop) and the voyage pane docked right. Both only reflect the skill's own files (docs/ghostship/STATE.md
// + BOARD.md) — no engine, no hidden state. Outside a Ghostship project they show an idle line.

const PANE = 'ghostship-voyage'
const STATE_FILE = 'docs/ghostship/STATE.md'
const BOARD_FILE = 'docs/ghostship/BOARD.md'
const EVIDENCE_FILE = 'docs/ghostship/EVIDENCE.md'

const snapAtom = atom({ plugin: 'ghostship', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'ghostship', key: 'hidden' } as const, false)
const updateAtom = atom({ plugin: 'ghostship', key: 'update' } as const, null)
const spendAtom = atom({ plugin: 'ghostship', key: 'spend' } as const, null)
const evidenceAtom = atom({ plugin: 'ghostship', key: 'evidence' } as const, [])
const filesOpenAtom = atom({ plugin: 'ghostship', key: 'filesOpen' } as const, false)
// The control panel above the prompt, opened from the ◆ Ghostship button in the prompt's footer.
const panelOpenAtom = atom({ plugin: 'ghostship', key: 'panelOpen' } as const, false)

// What the panel offers: the build modes and autonomy levels the skill knows, and the skill's own slash command.
const BUILD_MODES = ['tdd', 'verify', 'iterative'] as const
const AUTONOMY_LEVELS = ['autopilot', 'auto'] as const
const SKILL_COMMAND = 'ghostship:ghostship'
const boardOpenAtom = atom({ plugin: 'ghostship', key: 'boardOpen' } as const, true)
const recorderOpenAtom = atom({ plugin: 'ghostship', key: 'recorderOpen' } as const, true)

// Self-update: where the plugin lives on GitHub and how it's installed. Overridable by env.
// A hooks module runs without Node, so `process` may not exist: read the overrides only when it does.
const env = (typeof process !== 'undefined' && process.env) || {}
const REPO = env.GHOSTSHIP_REPO || 'shekharcharles/ghostship-skill'
const BRANCH = env.GHOSTSHIP_BRANCH || 'main'
const MARKET = env.GHOSTSHIP_MARKET || 'ghostship'
const PLUGIN = 'ghostship'
const RAW_MANIFEST = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/.claude-plugin/plugin.json`

// Module variables reset on reload; the elapsed clock simply restarts, which is fine.
let activeTask: string | null = null
let activeSince: number | null = null
let publishedKey = ''
let prevStatus: Record<string, string> = {}
// When each EVIDENCE.md line was first seen (0 for lines already there at the first read).
let stamps: number[] = []
let stamped = false
let installedVersion = ''
let branch = ''
let ticks = 0
// Subagents at work, by agent id: from their spawn to their stop.
// shortcut: an agent that never reports its stop keeps its row until the session restarts; sweep by age if that shows up.
const running = new Map<string, Running>()
const MAX_AGENT_ROWS = 4
// Rows kept for other mods' bands drawn above ours (What's Agent Doing's box is 3).
const OTHER_MOD_ROWS = 4
// A verdict shows on the band this long after it lands; the spinner's frames, one a second.
const NOTICE_MS = 20_000
const SPIN = ['◐', '◓', '◑', '◒']

// The plugin's own installed version, from its manifest — shown in the band and pane.
async function versionOf($: EngineInterface): Promise<string> {
  try { return (JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version as string) || '' } catch { return '' }
}
// The git branch of the project, read every few seconds; the band shows it when there is one.
async function readBranch($: EngineInterface): Promise<void> {
  try {
    const res = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 2000 })
    branch = res.exitCode === 0 ? res.stdout.trim() : ''
  } catch { branch = '' }
}
async function readVersion($: EngineInterface): Promise<void> {
  installedVersion = await versionOf($)
}

// Live local-model spend for the build: tokens, cost and context fill, from the session's own usage.
function toSpend(u: any): { tokens: number; usd: number; ctxPct: number } | null {
  if (!u) return null
  const tokens = u.context?.tokens ?? 0
  const win = u.context?.window ?? 0
  const ctxPct = u.context?.percent ?? (win ? Math.round((tokens / win) * 100) : 0)
  return { tokens, usd: u.cost?.usd ?? 0, ctxPct }
}
async function seedSpend($: EngineInterface): Promise<void> {
  try { const u = await $.session.usage(); await update($, spendAtom, () => toSpend(u)) } catch { /* no usage */ }
}

type Fs = { fs: { read: (p: string) => Promise<string> } }

// The pane's control, top right: – minimizes it to the ◆ Ghostship button in the prompt's footer, whose panel opens it again.
// A plain button: the engine may take a dismiss-role button before its onPress runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paneControls(ui: any, $: EngineInterface): any {
  const { Box, Button } = ui
  return (
    <Box key="controls" flexDirection="row" gap={2} justifyContent="flex-end">
      <Button key="pane-dock" label=" – " plain dimColor onPress={() => void setPane($, false)} />
    </Box>
  )
}

// Open or minimize the pane. It opens only when asked (a command or a press): a pane opened unasked waits for a
// 144-column window, so it could silently never show.
async function setPane($: EngineInterface, open: boolean): Promise<void> {
  if (open) await $.ui.open({ id: PANE, title: 'Ghostship' })
  else await $.ui.close({ id: PANE })
}

// Whether the pane is open, from the engine's own record: true however it was closed (–, Esc, the engine).
async function paneIsOpen($: EngineInterface): Promise<boolean> {
  try { return (await $.ui.panes()).some(p => p.id === PANE) } catch { return false }
}

async function readState($: Fs): Promise<GhostshipState | null> {
  try { return parseState(await $.fs.read(STATE_FILE)) } catch { return null }
}
async function readBoard($: Fs): Promise<Task[]> {
  try { return parseBoard(await $.fs.read(BOARD_FILE)) } catch { return [] }
}
// The overview reads files that may not exist (a plain app has no README or package.json).
async function tryRead($: Fs, path: string): Promise<string | null> {
  try { return await $.fs.read(path) } catch { return null }
}
async function tryList($: { fs: { list: (p?: string) => Promise<{ name: string; kind: string }[]> } }): Promise<{ name: string; kind: string }[]> {
  try { return await $.fs.list('.') } catch { return [] }
}

/** A snapshot from parsed state, with a given elapsed. Pure — safe to call while drawing. */
function snapFromState(st: GhostshipState, activeMs: number): VoyageSnap {
  const cur = curIndexOf(st.stage)
  const released = st.stage === 'done'
  const stop = st.stage ? STOP_AFTER[st.stage] ?? null : null
  return {
    stages: voyageOf(st.stage).map(s => ({ label: s.label, state: s.state })),
    curLabel: released ? 'Released' : (VOYAGE[cur]?.label ?? st.stage ?? ''),
    released,
    phase: st.phase,
    task: st.task,
    stop: st.awaiting ? stop : null,
    awaiting: !!st.awaiting,
    activeMs,
    visible: !!st.stage,
  }
}

/** Build the published snapshot, tracking when the active task last changed (so the clock is real). */
function buildSnap(st: GhostshipState, now: number): VoyageSnap {
  if (st.task !== activeTask) { activeTask = st.task; activeSince = st.task ? now : null }
  return snapFromState(st, activeSince !== null ? Math.max(0, now - activeSince) : -1)
}

// The build's verdict log. The skill's own EVIDENCE.md is the source when the project has one: lines there when the
// session starts are history, lines appended later are fresh (the band notices them). Older projects without the
// file fall back to board changes: each time a task reaches a terminal status, record it.
async function trackEvidence($: EngineInterface, now: number): Promise<void> {
  const text = await tryRead($, EVIDENCE_FILE)
  if (text !== null) {
    const all = parseEvidence(text)
    if (all.length === stamps.length && stamped) return
    stamps = stamped ? [...stamps.slice(0, all.length), ...all.slice(stamps.length).map(() => now)] : all.map(() => 0)
    stamped = true
    await update($, evidenceAtom, () => all.map((v, i) => ({ task: v.task, verdict: v.verdict, at: stamps[i] })).slice(-15))
    return
  }
  const board = await readBoard($)
  if (!board.length) return
  const first = Object.keys(prevStatus).length === 0
  const adds: { task: string; verdict: 'pass' | 'fail' | 'parked'; at: number }[] = []
  for (const t of board) {
    const terminal = t.status === 'done' || t.status === 'merged' ? 'pass' : t.status === 'parked' ? 'parked' : null
    if (!first && prevStatus[t.id] && prevStatus[t.id] !== t.status && terminal) adds.push({ task: t.id, verdict: terminal as 'pass' | 'parked', at: now })
    prevStatus[t.id] = t.status
  }
  if (adds.length) await update($, evidenceAtom, (log: { task: string; verdict: 'pass' | 'fail' | 'parked'; at: number }[] = []) => [...log, ...adds].slice(-15))
}

async function publish($: EngineInterface): Promise<void> {
  const st = await readState($)
  const now = await $.clock.now()
  try { await trackEvidence($, now) } catch { /* evidence is best-effort */ }
  const snap: VoyageSnap = st ? buildSnap(st, now) : { stages: [], curLabel: '', released: false, phase: null, task: null, stop: null, awaiting: false, activeMs: -1, visible: false }
  // Publish on change only; the band redraws each second between publishes.
  const key = JSON.stringify({ ...snap, activeMs: snap.activeMs >= 0 ? 'run' : 'none' })
  if (key === publishedKey) return
  publishedKey = key
  await update($, snapAtom, () => snap)
}

// Set one field of STATE.md (the panel's mode and autonomy), then show it at once.
async function setStateFieldOnDisk($: EngineInterface, key: string, value: string): Promise<void> {
  try {
    await $.fs.write(STATE_FILE, setStateField(await $.fs.read(STATE_FILE), key, value))
    await publish($)
    $.ui.invalidate('ui.render')
  } catch (err) {
    $.ui.toast(`Ghostship could not update STATE.md: ${(err as Error).message}`)
  }
}

async function setHidden($: EngineInterface, hidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => hidden)
  try { await $.store.set('hidden', hidden) } catch { /* this session only */ }
}

// Compare the installed manifest version with the one published on GitHub; note when a newer one exists.
async function checkUpdate($: EngineInterface): Promise<void> {
  try {
    const installed = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version as string
    const res = await $.process.run(['curl', '-fsSL', '-m', '8', RAW_MANIFEST])
    if (res.exitCode !== 0 || !res.stdout) return
    const latest = JSON.parse(res.stdout).version as string
    const newer = !!installed && !!latest && cmpVersion(latest, installed) > 0
    await update($, updateAtom, () => (newer ? { latest } : null))
  } catch { /* no network or no curl — just don't offer an update */ }
}

// One-click update: refresh the marketplace and update the plugin, then ask for a restart to apply.
async function doUpdate($: EngineInterface): Promise<void> {
  try {
    $.ui.toast('Ghostship: updating…')
    await $.process.run(['claude', 'plugin', 'marketplace', 'update', MARKET], { timeoutMs: 120000 })
    const r = await $.process.run(['claude', 'plugin', 'update', PLUGIN], { timeoutMs: 120000 })
    if (r.exitCode === 0) {
      await update($, updateAtom, () => null)
      $.ui.toast('Ghostship updated — restart Claude Code to apply.')
    } else {
      $.ui.toast(`Ghostship update failed: ${(r.stderr || r.stdout || 'unknown').trim().slice(0, 160)}`)
    }
  } catch (e) {
    $.ui.toast(`Ghostship update error: ${(e as Error).message}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    activeTask = null; activeSince = null; publishedKey = ''; stamps = []; stamped = false
    try { await readVersion($) } catch { /* unknown version */ }
    try { await seedSpend($) } catch { /* no spend */ }
    // Each step is guarded on its own, so one failure never stops the band from coming up.
    try { await $.command.register({ name: 'ghostship', description: 'Open the Ghostship pane', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-band', description: 'Ghostship: show or hide the voyage band', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-update', description: 'Ghostship: check for and install the latest version', immediate: true }) } catch { /* no command */ }
    try { const v = await $.store.get('hidden'); if (typeof v === 'boolean') await update($, hiddenAtom, () => v) } catch { /* nothing stored */ }
    // The band above the prompt is the only live line; clear any status line an older version pinned.
    try { $.ui.status(undefined) } catch { /* no status line */ }
    try { await publish($) } catch { /* the render falls back to a direct read */ }
    // Versions before 0.4.7 opened a second pane, the Overview; it is folded into the one pane now, so close any left open.
    try { await $.ui.close({ id: 'ghostship-overview' }) } catch { /* none open */ }
    // Live refresh: the snapshot every 1.5 s, and a redraw of the band and panes every second.
    try { $.clock.every(1500, () => { ticks += 1; if (ticks % 6 === 1) void readBranch($).catch(() => undefined); void publish($).catch(() => undefined) }) } catch { /* no live refresh */ }
    try { $.clock.every(1000, () => $.ui.invalidate('ui.render')) } catch { /* no redraw timer */ }
    // Check GitHub for a newer version, in the background; if there is one, a one-click Update row appears.
    void checkUpdate($).then(async () => { const u = await read($, updateAtom); if (u) $.ui.toast(`Ghostship ${u.latest} is available — click Update above the prompt, or /ghostship-update`) }).catch(() => undefined)
    return started
  })

  on('prompt.submit', async ($, e, next) => { await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => { await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('session.measure', async ($, e, next) => { const r = await next(e); try { await update($, spendAtom, () => toSpend(e as any)) } catch { /* ignore */ } return r }).catch(($, e, next) => next(e))

  // ---- subagent rows: the builder, the judge and any other subagent, each with its current step ----
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId !== undefined) running.set(result.agentId, { name: e.description || e.name || 'Agent', label: 'Getting started', startMs: await $.clock.now() })
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const a = e.agentId !== undefined ? running.get(e.agentId) : undefined
    if (a) a.label = stepOf(e.tool, e as unknown as Record<string, unknown>)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    running.delete(e.agent_id)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ghostship' }, async $ => {
    await setPane($, true)
    return { text: 'Ghostship pane opened.' }
  })

  on('command.run', { command: 'ghostship-update' }, async $ => {
    await checkUpdate($)
    const u = await read($, updateAtom)
    if (!u) return { text: 'Ghostship is up to date.' }
    await doUpdate($)
    return { text: `Updating Ghostship to ${u.latest}. Restart Claude Code to apply.` }
  })

  on('command.run', { command: 'ghostship-band' }, async $ => {
    const hidden = !(await read($, hiddenAtom))
    await setHidden($, hidden)
    return { text: hidden ? 'Ghostship band hidden. /ghostship-band brings it back.' : 'Ghostship band shown.' }
  })

  // ---- the band, above the prompt ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    // Mods are a terminal (SSH) convenience only. On mobile/desktop app surfaces they never render —
    // there, interaction is pure chat (AskUserQuestion), the same as Claude anywhere.
    if (e.surface !== 'terminal') return drawn
    if (e.props.hasSurvey) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    try {

    // The row budget: the engine gives this slot maxRows rows and drops a taller tree whole, without a word.
    // shortcut: other mods' rows drawn above ours cannot be measured, so OTHER_MOD_ROWS are kept for them whenever they
    // draw; raise it if a crowded band still vanishes.
    const budget = Math.max(0, (typeof e.props.maxRows === 'number' ? e.props.maxRows : 12) - (drawn ? OTHER_MOD_ROWS : 0))
    let used = 0
    const nowMs = await $.clock.now()
    const t = Math.floor(nowMs / 1000)

    // An update notice with a one-click Update — shown whenever a newer version is published, even outside a project.
    // Plain buttons: the engine may take a dismiss-role button before its onPress runs.
    const upd = await read($, updateAtom)
    let updateRow: unknown = null
    if (upd && budget - used >= 1) {
      used += 1
      updateRow = (
        <Box key="gs-upd" flexDirection="row">
          <Text color={GS.amber} bold>{`⬆ Ghostship ${upd.latest} available `}</Text>
          <Button key="gs-upd-go" label=" Update " variant="primary" onPress={() => void doUpdate($)} />
          <Button key="gs-upd-x" label=" ✕" plain dimColor onPress={() => void update($, updateAtom, () => null)} />
        </Box>
      )
    }

    // The control panel, opened from the ◆ Ghostship button in the prompt's footer: a card on the right, above the band.
    // Its rows: the build mode and autonomy (written to STATE.md), the band and the pane, and commands to launch.
    let panel: any = null
    if (await read($, panelOpenAtom)) {
      const pst = await readState($)
      const pIn = !!pst?.stage
      const pBoard = pIn ? await readBoard($) : []
      const pDone = pBoard.filter(t => t.status === 'done' || t.status === 'merged').length
      const pCur = pIn ? curIndexOf(pst!.stage) : -1
      const where = !pIn ? 'no voyage here' : pst!.stage === 'done' ? 'Released' : `${VOYAGE[pCur]?.label ?? pst!.stage}${pBoard.length ? ` · ${pDone}/${pBoard.length}` : ''}`
      const hidden = await read($, hiddenAtom)
      const paneUp = await paneIsOpen($)
      // A choice chip: the picked one is a filled chip, the others plain.
      const chip = (key: string, text: string, picked: boolean, press: () => void) => (
        <Button key={key} label={` ${text} `} {...(picked ? { variant: 'primary' as const } : { plain: true, dimColor: true })} onPress={press} />
      )
      const choice = (key: string, title: string, chips: any[]) => (
        <Box key={key} flexDirection="row" gap={1}>
          <Box width={10} flexShrink={0}><Text color="subtle">{title}</Text></Box>
          {chips}
        </Box>
      )
      const setting = (key: string, title: string, about: string, picked: boolean, chips: any[]) => (
        <Box key={key} flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
            <Text color={picked ? GS.green : GS.subtle}>{picked ? '●' : '○'}</Text>
            <Text bold>{title}</Text>
            <Text dimColor wrap="truncate-end">{about}</Text>
          </Box>
          <Box flexDirection="row" gap={1} flexShrink={0}>{chips}</Box>
        </Box>
      )
      const heading = (key: string, title: string) => <Text key={key} color="subtle">{title}</Text>
      const launch = (key: string, glyph: string, text: string, command: string) => (
        <Button key={key} label={`${glyph} ${text}`} plain onPress={() => void $.prompt.fill({ text: command }).catch(() => undefined)} />
      )

      // Fit the row budget: the panel drops its two section headings first, then its own border.
      const room = budget - used
      const base = 1 + (pIn ? 2 : 1) + 2 + 1
      const withHeads = room >= base + 2 + 2
      const pBordered = room >= base + (withHeads ? 2 : 0) + 2
      const rows: any[] = [
        <Box key="p-head" flexDirection="row" justifyContent="space-between">
          <Text bold color={GS.clay}>◆  G H O S T S H I P</Text>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Text color={pst?.awaiting ? GS.amber : GS.mist}>{pst?.awaiting ? '⏸ your move' : where}</Text>
            <Button key="p-x" label=" ✕" plain dimColor onPress={() => void update($, panelOpenAtom, () => false)} />
          </Box>
        </Box>,
        ...(pIn
          ? [
              choice('p-mode', 'MODE', BUILD_MODES.map(m => chip(`p-m-${m}`, m, pst!.mode === m, () => void setStateFieldOnDisk($, 'mode', m)))),
              choice('p-auto', 'AUTONOMY', AUTONOMY_LEVELS.map(a => chip(`p-a-${a}`, a, (pst!.autonomy || 'autopilot') === a, () => void setStateFieldOnDisk($, 'autonomy', a)))),
            ]
          : [<Text key="p-none" dimColor>Start a voyage to pick the build mode and autonomy.</Text>]),
        withHeads ? heading('p-sh', 'S E T T I N G S') : null,
        setting('p-band', 'Band', 'the voyage line above the prompt', !hidden, [
          chip('p-b-on', 'On', !hidden, () => void setHidden($, false)),
          chip('p-b-off', 'Off', hidden, () => void setHidden($, true)),
        ]),
        setting('p-pane', 'Pane', 'the Ghostship pane on the right', paneUp, [
          chip('p-p-open', 'Open', paneUp, () => void setPane($, true)),
          chip('p-p-min', 'Minimized', !paneUp, () => void setPane($, false)),
        ]),
        withHeads ? heading('p-lh', 'L A U N C H') : null,
        <Box key="p-launch" flexDirection="row" flexWrap="wrap" gap={2}>
          {launch('p-l-new', '✦', 'New voyage', `/${SKILL_COMMAND} new`)}
          {launch('p-l-resume', '◆', 'Resume', `/${SKILL_COMMAND} resume`)}
          {launch('p-l-status', '◆', 'Status', `/${SKILL_COMMAND} status`)}
          {launch('p-l-release', '◆', 'Release', `/${SKILL_COMMAND} release`)}
        </Box>,
      ]
      if (room >= base) {
        used += base + (withHeads ? 2 : 0) + (pBordered ? 2 : 0)
        const width = Math.min(72, Math.max(40, (e.props.bodyColumns || 80) - 2))
        panel = pBordered
          ? <Box key="gs-panel" flexDirection="column" alignSelf="flex-end" width={width} borderStyle="round" borderColor={GS.clay} paddingX={1}>{rows}</Box>
          : <Box key="gs-panel" flexDirection="column" alignSelf="flex-end" width={width}>{rows}</Box>
      }
    }

    // The band: one card, its border the state at a glance — amber waits on you, green is released, clay is building,
    // grey is idle. Inside: the voyage line, then a STOP waiting or a fresh verdict, then a row per subagent at work.
    let card: unknown = null
    // While the panel is open it stands in for the band card (its header carries the stage), so both never overflow the rows.
    if (!panel && !(await read($, hiddenAtom)) && budget - used >= 1) {
      let snap = await read($, snapAtom)
      if (!snap || !snap.visible) {
        const st = await readState($)
        snap = st && st.stage ? snapFromState(st, -1) : null
      }
      const inProject = !!(snap && snap.visible)
      const bordered = budget - used >= 3
      // Inside the card: the border and padding take 4 columns, the ✕ takes 3.
      const inner = Math.max(24, (e.props.bodyColumns || 80) - (bordered ? 4 : 0) - 3)
      const hide = <Button key="gs-band-x" label=" ✕" plain dimColor onPress={() => void setHidden($, true)} />

      const head = snap && inProject
        ? bandTree(ui, {
          stages: snap.stages, curLabel: snap.curLabel, released: snap.released, phase: snap.phase, task: snap.task,
          stop: snap.stop, awaiting: snap.awaiting, activeMs: snap.activeMs, version: installedVersion, branch,
        }, inner, t, snap.activeMs)
        : (
          <Box key="gs-idle" flexDirection="row" gap={3} flexGrow={1}>
            <Box flexShrink={0}><Text color={GS.clay} bold>{`⛴ Ghostship${installedVersion ? ` v${installedVersion}` : ''}`}</Text></Box>
            <Text dimColor wrap="truncate-end">no voyage here · /ghostship new to start one</Text>
            {branch ? <Box flexShrink={0}><Text color={GS.subtle}>{`⎇ ${branch}`}</Text></Box> : null}
          </Box>
        )
      const rows: unknown[] = [<Box key="gs-head" flexDirection="row" justifyContent="space-between">{head}{hide}</Box>]
      let room = budget - used - (bordered ? 3 : 1)

      // A STOP waiting on the owner stays until it is answered; otherwise a verdict shows for 20 seconds after it lands.
      if (snap && inProject && room >= 1) {
        if (snap.awaiting) {
          rows.push(
            <Box key="gs-wait" flexDirection="row" gap={2}>
              <Text color={GS.amber} bold>{`⏸ ${snap.stop ?? 'waiting on you'}`}</Text>
              <Button key="gs-wait-open" label=" open " hotkey="o" variant="primary" onPress={() => void $.ui.open({ id: PANE, title: 'Ghostship' })} />
            </Box>,
          )
          room -= 1
        } else {
          const ev = (await read($, evidenceAtom)).at(-1)
          if (ev && nowMs - ev.at < NOTICE_MS) {
            rows.push(ev.verdict === 'pass'
              ? <Text key="gs-note" color={GS.green}>{`✓ ${ev.task} passed`}</Text>
              : ev.verdict === 'fail'
                ? <Text key="gs-note" color="error">{`✗ ${ev.task} failed`}</Text>
                : <Text key="gs-note" color={GS.amber}>{`⚠ ${ev.task} parked`}</Text>)
            room -= 1
          }
        }
      }

      // One row per subagent at work: a spinner in the role's colour, its name, its step in words, its elapsed time.
      // Fixed parts never shrink; the step truncates. The newest rows are kept when there is no room for all.
      const all = [...running.values()]
      const fit = fitAgents(all.length, room, MAX_AGENT_ROWS)
      all.slice(all.length - fit.shown).forEach((a, i) => {
        const role = roleOf(a.name)
        const color = role === 'judge' ? GS.amber : role === 'builder' ? GS.clay : GS.mist
        rows.push(
          <Box key={`gs-ag${i}`} flexDirection="row">
            <Box flexShrink={0}><Text color={color}>{`${SPIN[(t + i) % SPIN.length]} `}</Text><Text bold>{a.name.slice(0, 40)}</Text></Box>
            <Text wrap="truncate-end">{` › ${a.label}`}</Text>
            <Box flexShrink={0}><Text dimColor>{`  ${clock(nowMs - a.startMs)}`}</Text></Box>
          </Box>,
        )
      })
      if (fit.more > 0) rows.push(<Text key="gs-ag-more" dimColor>{`… ${fit.more} more agent${fit.more === 1 ? '' : 's'}`}</Text>)

      const tone = !snap || !inProject ? GS.subtle : snap.awaiting ? GS.amber : snap.released ? GS.green : snap.task || all.length ? GS.clay : GS.mist
      card = bordered
        ? <Box key="gs-card" flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1}>{rows}</Box>
        : rows[0]
    }

    if (!updateRow && !panel && !card) return drawn
    return <Box flexDirection="column">{drawn}{updateRow}{panel}{card}</Box>
    } catch (err) {
      const msg = (err as Error).message
      $.ui.log(`ghostship band: ${msg}`, { to: "debug" })
      return <Box flexDirection="column">{drawn}<Text color={GS.amber}>{`ghostship band error: ${msg}`}</Text></Box>
    }
  })

  // ---- the footer button: ◆ Ghostship at the right of the prompt's footer, beside the engine's own mode labels ----
  // It opens and closes the control panel; the panel brings back a docked or closed pane and a hidden band.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal') return drawn
    const { Box, Button } = $.ui.resolve(e)
    const open = await read($, panelOpenAtom)
    return (
      <Box flexDirection="row" gap={2}>
        {drawn}
        <Button key="gs-foot" label={`◆ Ghostship ${open ? '▴' : '▾'}`} {...(open ? { variant: 'primary' as const } : { variant: 'secondary' as const })} onPress={() => void update($, panelOpenAtom, () => !open)} />
      </Box>
    )
  })

  // ---- the Ghostship pane, docked right: the app, its voyage and its build in one view ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const controls = paneControls(ui, $)
    const version = await versionOf($)
    const spend = await read($, spendAtom)
    const evidence = await read($, evidenceAtom)
    const boardOpen = await read($, boardOpenAtom)
    const recorderOpen = await read($, recorderOpenAtom)
    const filesOpen = await read($, filesOpenAtom)
    const st = await readState($)
    const inProject = !!st?.stage
    const board = inProject ? await readBoard($) : []
    const { name, about } = appIdentity(await tryRead($, 'package.json'), await tryRead($, 'README.md'))
    const files = appEntries(await tryList($))
    const nowMs = await $.clock.now()
    const agents = [...running.values()]

    // One round card per section from 44 columns, as ruflo's console draws its sections; narrower, plain stacks.
    const cols = e.props.bodyColumns ?? 40
    const cards = cols >= 44
    const inner = Math.max(10, cols - (cards ? 4 : 2))
    const section = (key: string, edge: string, body: any) => cards
      ? <Box key={key} flexDirection="column" borderStyle="round" borderColor={edge} paddingX={1}>{body}</Box>
      : <Box key={key} flexDirection="column" paddingX={1}>{body}</Box>
    const head = (label: string, right?: string) => (
      <Box key={`h-${label}`} justifyContent="space-between">
        <Text color="subtle">{label}</Text>
        {right ? <Text color="subtle">{right}</Text> : null}
      </Box>
    )
    // A section header that folds: ▾ open, ▸ folded.
    const disclosure = (label: string, isOpen: boolean, right: string, toggle: () => void) => (
      <Box key={`d-${label}`} justifyContent="space-between">
        <Button plain dimColor label={`${isOpen ? '▾' : '▸'} ${label}`} onPress={toggle} />
        <Text color="subtle">{right}</Text>
      </Box>
    )
    // Rows each list may take, so the pane fits its height; the rest is counted.
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 26)
    const capped = (key: string, rows: any[]): any[] =>
      rows.length > room ? [...rows.slice(0, room), <Text key={`${key}-more`} dimColor>{`  … ${rows.length - room} more`}</Text>] : rows

    // The state at a glance, on the banner's and the progress card's borders: amber waits on you, green is released.
    const edge = st?.awaiting ? 'warning' : st?.stage === 'done' ? 'success' : 'claude'
    const cur = inProject ? curIndexOf(st!.stage) : -1
    const stageLabel = st?.stage === 'done' ? 'Released' : inProject ? (VOYAGE[cur]?.label ?? st!.stage) : null
    const done = board.filter(t => t.status === 'done' || t.status === 'merged').length
    const parked = board.filter(t => t.status === 'parked').length
    const active = board.find(t => t.id === st?.task)

    // Progress: tasks done once there is a board; before that, how far along the seven stages the voyage is.
    const progress = !inProject
      ? [head('PROGRESS'), <Text key="pn" dimColor>No voyage here yet · /ghostship new to start one</Text>]
      : [
          head('PROGRESS', board.length
            ? `${done}/${board.length} tasks · ${Math.round((done / board.length) * 100)}%`
            : `stage ${Math.min(cur + 1, VOYAGE.length)}/${VOYAGE.length}`),
          <Text key="pb" color={st!.awaiting ? GS.amber : GS.clay}>
            {board.length ? progressBar(done, board.length, inner) : progressBar(Math.max(0, cur), VOYAGE.length, inner)}
          </Text>,
          parked ? <Text key="pk" color="warning">{`⚠ ${parked} parked`}</Text> : null,
          st!.awaiting ? <Text key="aw" color="warning">{`⏸ ${st!.awaiting}`}</Text> : null,
        ]

    const voyageRows = inProject ? voyageOf(st!.stage).map((s, i) => {
      const mk = statusMark(s.state === 'd' ? 'done' : s.state === 'c' ? 'current' : 'todo')
      return (
        <Box key={s.key}>
          <Text color={mk.color} bold={mk.bold} dimColor={s.state === 'd'}>{mk.glyph} {s.label}</Text>
          {s.key === 'spec' && i < cur ? <Text color="subtle">  locked</Text> : null}
          {s.key === 'spec' || s.key === 'release' ? <Text color={st!.awaiting && s.state === 'c' ? 'warning' : 'subtle'}>{`  ⏸ STOP ${s.key === 'spec' ? 1 : 2}`}</Text> : null}
        </Box>
      )
    }) : []

    // The board, grouped by what the tasks have become: built, being built, planned, parked.
    const group = (key: string, title: string, glyph: string, color: string, tasks: Task[]) => tasks.length ? [
      <Text key={`${key}-h`} bold color={color}>{`${glyph} ${title}  ${tasks.length}`}</Text>,
      ...capped(key, tasks.map(t => <Text key={`${key}-${t.id}`} wrap="truncate-end">{`  ${t.id}  `}<Text color="subtle">{t.label}</Text></Text>)),
    ] : []
    const isBuilt = (t: Task) => t.status === 'done' || t.status === 'merged'
    const isBuilding = (t: Task) => t.status === 'building' || t.status === 'judging' || t.status === 'doing'
    const boardBody = [
      ...group('gb', 'Built', '✓', GS.green, board.filter(isBuilt)),
      ...group('ga', 'Building', '●', GS.amber, board.filter(isBuilding)),
      ...group('gp', 'Planned', '○', GS.mist, board.filter(t => !isBuilt(t) && !isBuilding(t) && t.status !== 'parked')),
      ...group('gk', 'Parked', '⚠', GS.amber, board.filter(t => t.status === 'parked')),
    ]

    return (
      <Box flexDirection="column" gap={cards ? 0 : 1}>
        {section('s-banner', edge, [
          controls,
          <Text key="brand" bold color={GS.clay}>⛴  G H O S T S H I P</Text>,
          <Text key="ver" dimColor>{version ? `v${version}` : ' '}</Text>,
          <Box key="app" justifyContent="space-between" marginTop={1}>
            <Text bold>{name ?? 'This app'}</Text>
            {stageLabel ? <Text color={st?.awaiting ? 'warning' : 'claude'}>{st?.awaiting ? '⏸ YOUR MOVE' : `● ${stageLabel}`}</Text> : null}
          </Box>,
          about
            ? <Text key="about" color={GS.mist} wrap="wrap">{about}</Text>
            : <Text key="about" dimColor wrap="wrap">No description yet: add one to package.json, or open the README with a one-line pitch.</Text>,
        ])}
        {section('s-progress', edge, progress)}
        {inProject ? section('s-voyage', 'subtle', [head('VOYAGE', st!.phase ? `PHASE ${st!.phase}` : undefined), ...voyageRows]) : null}
        {agents.length ? section('s-agents', 'claude', [
          head('AGENTS', `${agents.length} at work`),
          ...agents.map((a, i) => {
            const role = roleOf(a.name)
            return (
              <Box key={`pa${i}`} flexDirection="row">
                <Box flexShrink={0}><Text color={role === 'judge' ? 'warning' : role === 'builder' ? 'claude' : 'subtle'}>{`${SPIN[(Math.floor(nowMs / 1000) + i) % SPIN.length]} `}</Text><Text bold>{a.name.slice(0, 30)}</Text></Box>
                <Text wrap="truncate-end">{` › ${a.label}`}</Text>
                <Box flexShrink={0}><Text dimColor>{`  ${clock(nowMs - a.startMs)}`}</Text></Box>
              </Box>
            )
          }),
        ]) : null}
        {inProject && (active || st!.red || st!.green) ? section('s-flight', 'subtle', [
          head('IN FLIGHT', active ? `${active.id} · ${active.label}` : undefined),
          st!.builder ? <Text key="b" dimColor>{`builder ${st!.builder}`}</Text> : null,
          st!.judge ? <Text key="j" color="claude" bold>{`◆ judge `}<Text dimColor>{st!.judge}</Text></Text> : null,
          st!.red ? <Text key="r" color="error">{`red  ✗ `}<Text dimColor>{st!.red}</Text></Text> : null,
          st!.green ? <Text key="g" color="success">{`green ✓ `}<Text dimColor>{st!.green}</Text></Text> : null,
        ]) : null}
        {board.length ? section('s-board', 'subtle', [
          disclosure('BOARD', boardOpen, `${board.length} TASKS`, () => void update($, boardOpenAtom, () => !boardOpen)),
          ...(boardOpen ? boardBody : []),
        ]) : null}
        {evidence && evidence.length ? section('s-rec', 'subtle', [
          disclosure('RECORDER', recorderOpen, `${evidence.length} verdicts`, () => void update($, recorderOpenAtom, () => !recorderOpen)),
          recorderOpen ? (
            <Box key="ev" flexWrap="wrap">
              {evidence.slice(-6).map((v, i) => (
                <Text key={`ev${i}`} color={v.verdict === 'pass' ? 'success' : v.verdict === 'fail' ? 'error' : 'warning'}>{`${v.verdict === 'pass' ? '✓' : v.verdict === 'fail' ? '✗' : '⚠'} ${v.task}  `}</Text>
              ))}
            </Box>
          ) : null,
        ]) : null}
        {section('s-files', 'subtle', [
          disclosure('FILES', filesOpen, `${files.length} at the top level`, () => void update($, filesOpenAtom, () => !filesOpen)),
          ...(filesOpen
            ? capped('f', files.length
              ? files.map((f, i) => f.isDir
                ? <Text key={`f${i}`} bold color={GS.mist}>{`  ${f.name}/`}</Text>
                : <Text key={`f${i}`} color={GS.subtle}>{`  ${f.name}`}</Text>)
              : [<Text key="f-none" dimColor>  no files</Text>])
            : []),
        ])}
        {spend || inProject ? section('s-foot', 'subtle', [
          spend ? head('SPEND', spend.usd > 0 ? `$${spend.usd.toFixed(2)}` : 'local') : null,
          spend ? (
            <Box key="sp">
              <Text color="subtle">{`tokens `}</Text>
              <Text>{fmtTokens(spend.tokens)}</Text>
              <Text color="subtle">{`   context `}</Text>
              <Text color={spend.ctxPct >= 85 ? 'warning' : 'subtle'}>{`${spend.ctxPct}%`}</Text>
            </Box>
          ) : null,
          inProject ? <Text key="auto" color="subtle">{`autonomy ${st!.autonomy || 'autopilot'}`}</Text> : null,
        ]) : null}
      </Box>
    )
  })
}
