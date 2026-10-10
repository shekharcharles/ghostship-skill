import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  VOYAGE, STOP_AFTER, parseState, parseBoard, voyageOf, curIndexOf,
  progressBar, statusMark, cmpVersion, type GhostshipState, type Task,
} from './state.ts'
import type { VoyageSnap } from '../types'
import { bandTree, type BandProps } from './band.tsx'
import { GS, fmtTokens } from './lib.ts'
import { appEntries, appIdentity, featuresOf } from './overview.ts'

// Ghostship's two live surfaces: the band above the prompt (drawn by the hooks module on the terminal, one SVG on the
// desktop) and the voyage pane docked right. Both only reflect the skill's own files (docs/ghostship/STATE.md
// + BOARD.md) — no engine, no hidden state. Inert outside a Ghostship project.

const PANE = 'ghostship-voyage'
const APP_PANE = 'ghostship-overview'
const STATE_FILE = 'docs/ghostship/STATE.md'
const BOARD_FILE = 'docs/ghostship/BOARD.md'

const snapAtom = atom({ plugin: 'ghostship', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'ghostship', key: 'hidden' } as const, false)
const updateAtom = atom({ plugin: 'ghostship', key: 'update' } as const, null)
const spendAtom = atom({ plugin: 'ghostship', key: 'spend' } as const, null)
const evidenceAtom = atom({ plugin: 'ghostship', key: 'evidence' } as const, [])
const foldedAtom = atom({ plugin: 'ghostship', key: 'folded' } as const, false)
const foldedAppAtom = atom({ plugin: 'ghostship', key: 'foldedApp' } as const, false)
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
let installedVersion = ''
let branch = ''
let ticks = 0

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

// Every pane carries the same two controls. Minimize folds it to its header row; Close removes it until the next session starts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paneControls(ui: any, $: EngineInterface, id: string, folded: boolean, toggleFold: () => void): any {
  const { Box, Button } = ui
  return (
    <Box flexDirection="row" gap={2} justifyContent="flex-end">
      <Button key={`${id}-fold`} label={folded ? 'Expand' : 'Minimize'} plain dimColor onPress={toggleFold} />
      <Button key={`${id}-close`} label="Close" plain dimColor role="dismiss" onPress={() => void $.ui.close({ id })} />
    </Box>
  )
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

// The build's verdict log: each time a task reaches a terminal status on the board, record it.
async function trackEvidence($: EngineInterface, now: number): Promise<void> {
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

async function refreshStatus($: EngineInterface): Promise<void> {
  const st = await readState($)
  if (!st || !st.stage) { $.ui.status(undefined); return }
  // One plain line under the prompt, the glance view when the band is hidden: version · stage · phase · task · STOP.
  const i = curIndexOf(st.stage)
  const parts = [installedVersion ? `⛴ v${installedVersion}` : '⛴', st.stage === 'done' ? 'released' : (VOYAGE[i]?.label ?? st.stage)]
  if (st.phase) parts.push(`phase ${st.phase}`)
  if (st.task) parts.push(st.task)
  if (st.awaiting) parts.push(`⏸ ${st.awaiting}`)
  $.ui.status(parts.join(' · '))
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
    activeTask = null; activeSince = null; publishedKey = ''
    try { await readVersion($) } catch { /* unknown version */ }
    try { await seedSpend($) } catch { /* no spend */ }
    // Each step is guarded on its own, so one failure never stops the band from coming up.
    try { await $.command.register({ name: 'ghostship', description: 'Open the Ghostship voyage pane', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-band', description: 'Ghostship: show or hide the voyage band', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-update', description: 'Ghostship: check for and install the latest version', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-overview', description: 'Ghostship: show the whole app — what it is, what is built, its files', immediate: true }) } catch { /* no command */ }
    try { const v = await $.store.get('hidden'); if (typeof v === 'boolean') await update($, hiddenAtom, () => v) } catch { /* nothing stored */ }
    try { await refreshStatus($) } catch { /* no status */ }
    try { await publish($) } catch { /* the render falls back to a direct read */ }
    try { if (e.surface === 'terminal') void $.ui.open({ id: PANE, title: 'Ghostship' }) } catch { /* no pane */ }
    // Live refresh: the snapshot and status line every 1.5 s, and a redraw of the band and panes every second.
    try { $.clock.every(1500, () => { ticks += 1; if (ticks % 6 === 1) void readBranch($).catch(() => undefined); void publish($).catch(() => undefined); void refreshStatus($).catch(() => undefined) }) } catch { /* no live refresh */ }
    try { $.clock.every(1000, () => $.ui.invalidate('ui.render')) } catch { /* no redraw timer */ }
    // Check GitHub for a newer version, in the background; if there is one, a one-click Update row appears.
    void checkUpdate($).then(async () => { const u = await read($, updateAtom); if (u) $.ui.toast(`Ghostship ${u.latest} is available — click Update above the prompt, or /ghostship-update`) }).catch(() => undefined)
    return started
  })

  on('prompt.submit', async ($, e, next) => { await refreshStatus($); await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => { await refreshStatus($); await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('session.measure', async ($, e, next) => { const r = await next(e); try { await update($, spendAtom, () => toSpend(e as any)) } catch { /* ignore */ } return r }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ghostship' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Ghostship' })
    return { text: 'Ghostship voyage pane opened.' }
  })

  on('command.run', { command: 'ghostship-overview' }, async $ => {
    await $.ui.open({ id: APP_PANE, title: 'Overview' })
    return { text: 'Ghostship overview pane opened.' }
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
  // The whole app at a glance. Reads the project's files as it draws, like the voyage pane does.
  on('ui.render', { component: 'Pane', requestId: APP_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const folded = await read($, foldedAppAtom)
    const controls = paneControls(ui, $, APP_PANE, folded, () => void update($, foldedAppAtom, () => !folded))
    const st = await readState($)
    const tasks = await readBoard($)
    const { name, about } = appIdentity(await tryRead($, 'package.json'), await tryRead($, 'README.md'))
    const files = appEntries(await tryList($))
    const feats = featuresOf(tasks)
    const done = tasks.filter(t => t.status === 'done').length
    const room = Math.max(5, (e.viewport?.rows ?? 30) - 16)
    const bar = progressBar(done, tasks.length, 12) || '░'.repeat(12)

    if (folded) {
      return <Box paddingX={1} justifyContent="space-between"><Text bold color={GS.clay}>◆ {name ?? 'App'} overview</Text>{controls}</Box>
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {controls}
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={GS.clay}>◆ {name ?? 'App'} <Text color={GS.mist}>overview</Text></Text>
          <Text bold color={st?.awaiting ? GS.amber : GS.clay}>{st?.stage ?? 'no stage'}</Text>
        </Box>
        {about ? <Text color={GS.mist} wrap="truncate-end">{about}</Text> : null}
        <Text color={GS.subtle}>{'─'.repeat(36)}</Text>

        <Box flexDirection="row" marginTop={1}>
          <Text color={GS.clay}>{bar}</Text>
          <Text color={GS.mist}> {done}/{tasks.length} tasks done</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold color={GS.green}>✓ Built</Text>
          {feats.built.length === 0 && <Text color={GS.subtle}>  nothing built yet</Text>}
          {feats.built.slice(0, room).map(f => <Text color={GS.green} wrap="truncate-end">  {f}</Text>)}
          <Text bold color={GS.amber}>● Building</Text>
          {feats.active.length === 0 && <Text color={GS.subtle}>  nothing in progress</Text>}
          {feats.active.slice(0, room).map(f => <Text color={GS.amber} wrap="truncate-end">  {f}</Text>)}
          <Text bold color={GS.mist}>○ Planned</Text>
          {feats.planned.length === 0 && <Text color={GS.subtle}>  nothing planned</Text>}
          {feats.planned.slice(0, room).map(f => <Text color={GS.mist} wrap="truncate-end">  {f}</Text>)}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold color={GS.clay}>Files</Text>
          {files.length === 0 && <Text color={GS.subtle}>  no files</Text>}
          {files.slice(0, room).map(f =>
            f.isDir ? <Text bold color={GS.mist}>  {f.name}/</Text> : <Text color={GS.subtle}>  {f.name}</Text>,
          )}
        </Box>

        <Box marginTop={1}>
          <Text color={GS.subtle}>/ghostship-overview refreshes this</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    // Mods are a terminal (SSH) convenience only. On mobile/desktop app surfaces they never render —
    // there, interaction is pure chat (AskUserQuestion), the same as Claude anywhere.
    if (e.surface !== 'terminal') return drawn
    if (e.props.hasSurvey) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    // An update notice with a one-click Update — shown whenever a newer version is published, even
    // outside a project.
    const upd = await read($, updateAtom)
    const updateRow = upd ? (
      <Box key="gs-upd" flexDirection="row">
        <Text color={GS.amber} bold>{`⬆ Ghostship ${upd.latest} available `}</Text>
        <Button key="gs-upd-go" label=" Update " role="primary" onPress={() => void doUpdate($)} />
        <Button key="gs-upd-x" label=" ✕" plain dimColor role="dismiss" onPress={() => void update($, updateAtom, () => null)} />
      </Box>
    ) : null

    // The voyage band — only inside a project, and not hidden.
    let band: unknown = null
    let waitRow: unknown = null
    if (!(await read($, hiddenAtom))) {
      let snap = await read($, snapAtom)
      if (!snap || !snap.visible) {
        const st = await readState($)
        snap = st && st.stage ? snapFromState(st, -1) : null
      }
      if (snap && snap.visible) {
        const cols = Math.max(24, (e.props.bodyColumns || 80) - 3)
        const props: BandProps = {
          stages: snap.stages, curLabel: snap.curLabel, released: snap.released,
          phase: snap.phase, task: snap.task, stop: snap.stop, awaiting: snap.awaiting, activeMs: snap.activeMs, version: installedVersion, branch,
        }
        // Drawn right here, not in a surface module: the band fits one line, dropping the least important parts first.
        const t = Math.floor((await $.clock.now()) / 1000)
        band = (
          <Box key="gs-band" flexDirection="row">
            {bandTree(ui, props, cols, t, props.activeMs)}
            <Button key="gs-band-x" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        )
        // A STOP is waiting on the owner: say so, with a button that opens the voyage pane.
        if (snap.awaiting) {
          waitRow = (
            <Box key="gs-wait" flexDirection="row" paddingX={1} gap={2}>
              <Text color={GS.amber} bold>{`⏸ ${snap.stop ?? 'waiting on you'}`}</Text>
              <Button key="gs-wait-open" label=" open " hotkey="o" role="primary" onPress={() => void $.ui.open({ id: PANE, title: 'Ghostship' })} />
            </Box>
          )
        }
      }
    }

    if (!updateRow && !band && !waitRow) return drawn
    return <Box flexDirection="column">{drawn}{updateRow}{band}{waitRow}</Box>
  })

  // ---- the voyage pane, docked right ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const folded = await read($, foldedAtom)
    // Read on every draw, so the pane shows the version actually loaded — a hot reload changes it at once.
    const version = await versionOf($)
    const label = version ? `⛴ GHOSTSHIP v${version}` : '⛴ GHOSTSHIP'
    const controls = paneControls(ui, $, PANE, folded, () => void update($, foldedAtom, () => !folded))
    if (folded) {
      return <Box paddingX={1} justifyContent="space-between"><Text bold color={GS.clay}>{label}</Text>{controls}</Box>
    }
    const spend = await read($, spendAtom)
    const evidence = await read($, evidenceAtom)
    const boardOpen = await read($, boardOpenAtom)
    const recorderOpen = await read($, recorderOpenAtom)
    const st = await readState($)
    if (!st || !st.stage) {
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          {controls}
          <Text bold color={GS.clay}>{label}</Text>
          <Text bold color={GS.clay}>No Ghostship project here yet.</Text>
          <Text color={GS.mist}>Run /ghostship new to start one, or /ghostship-overview to see this app.</Text>
        </Box>
      )
    }
    const board = await readBoard($)
    const cur = curIndexOf(st.stage)
    const doneTasks = board.filter(t => t.status === 'done' || t.status === 'merged').length
    const active = board.find(t => t.id === st.task)

    const voyageRows = voyageOf(st.stage).map((s, i) => {
      const mk = statusMark(s.state === 'd' ? 'done' : s.state === 'c' ? 'current' : 'todo')
      const isBuild = s.key === 'build' && s.state === 'c' && board.length > 0
      return (
        <Box key={s.key}>
          <Text color={mk.color} bold={mk.bold} dimColor={s.state === 'd'}>{mk.glyph} {s.label}</Text>
          {s.key === 'spec' && i < cur ? <Text color="subtle">  locked</Text> : null}
          {isBuild ? <Text color="claude">{`  ${progressBar(doneTasks, board.length)} `}</Text> : null}
          {isBuild ? <Text color="subtle">{`${doneTasks}/${board.length}`}</Text> : null}
        </Box>
      )
    })

    const boardRows: unknown[] = []
    for (let i = 0; i < board.length; i += 2) {
      const cell = (t: Task | undefined, k: string) => {
        if (!t) return <Box key={k} flexGrow={1} />
        const mk = statusMark(t.status)
        return (
          <Box key={k} flexGrow={1}>
            <Text color={mk.color} bold={mk.bold} dimColor={t.status === 'done' || t.status === 'merged'}>{mk.glyph} {t.id}</Text>
            <Text color="subtle">{` ${t.label}`}</Text>
          </Box>
        )
      }
      boardRows.push(<Box key={`r${i}`} gap={2}>{cell(board[i], `a${i}`)}{cell(board[i + 1], `b${i}`)}</Box>)
    }

    const head = (label: string, right?: string) => (
      <Box justifyContent="space-between">
        <Text color="subtle">{label}</Text>
        {right ? <Text color="subtle">{right}</Text> : null}
      </Box>
    )
    // A section header with a disclosure triangle, as What's Agent Doing's box has: ▸ folded, ▾ open.
    const disclosure = (label: string, isOpen: boolean, right: string, toggle: () => void) => (
      <Box justifyContent="space-between">
        <Button plain dimColor label={`${isOpen ? '▾' : '▸'} ${label}`} onPress={toggle} />
        <Text color="subtle">{right}</Text>
      </Box>
    )
    // The border names the state at a glance: amber when the voyage waits on the owner, green when released.
    const border = st.awaiting ? 'warning' : st.stage === 'done' ? 'success' : 'claude'

    return (
      <Box flexDirection="column" gap={1} paddingX={1} borderStyle="round" borderColor={border}>
        {controls}
        <Box justifyContent="space-between">
          <Text color="claude" bold>{label}</Text>
          <Text color={st.awaiting ? 'warning' : 'claude'}>
            {st.awaiting ? '⏸ YOUR MOVE' : st.stage === 'done' ? '✓ RELEASED' : `● ${(st.stage || '').toUpperCase()}`}
          </Text>
        </Box>
        <Box flexDirection="column">
          {head('VOYAGE', st.phase ? `PHASE ${st.phase}` : undefined)}
          {voyageRows}
        </Box>
        {board.length > 0 ? (
          <Box flexDirection="column">
            {disclosure('BOARD', boardOpen, `${board.length} TASKS`, () => void update($, boardOpenAtom, () => !boardOpen))}
            {boardOpen ? boardRows : null}
          </Box>
        ) : null}
        {active || st.red || st.green ? (
          <Box flexDirection="column">
            {head('IN FLIGHT', active ? `${active.id} · ${active.label}` : undefined)}
            {st.builder ? <Text dimColor>{`builder ${st.builder}`}</Text> : null}
            {st.judge ? <Text color="claude" bold>{`◆ judge `}<Text dimColor>{st.judge}</Text></Text> : null}
            {st.red ? <Text color="error">{`red  ✗ `}<Text dimColor>{st.red}</Text></Text> : null}
            {st.green ? <Text color="success">{`green ✓ `}<Text dimColor>{st.green}</Text></Text> : null}
          </Box>
        ) : null}
        {evidence && evidence.length ? (
          <Box flexDirection="column">
            {disclosure('RECORDER', recorderOpen, `${evidence.length} verdicts`, () => void update($, recorderOpenAtom, () => !recorderOpen))}
            {recorderOpen ? (
              <Box flexWrap="wrap">
                {evidence.slice(-6).map((v, i) => (
                  <Text key={`ev${i}`} color={v.verdict === 'pass' ? 'success' : 'warning'}>{`${v.verdict === 'pass' ? '✓' : '⚠'} ${v.task}  `}</Text>
                ))}
              </Box>
            ) : null}
          </Box>
        ) : null}
        {spend ? (
          <Box flexDirection="column">
            {head('SPEND', spend.usd > 0 ? `$${spend.usd.toFixed(2)}` : 'local')}
            <Box>
              <Text color="subtle">{`tokens `}</Text>
              <Text>{fmtTokens(spend.tokens)}</Text>
              <Text color="subtle">{`   context `}</Text>
              <Text color={spend.ctxPct >= 85 ? 'warning' : 'subtle'}>{`${spend.ctxPct}%`}</Text>
            </Box>
          </Box>
        ) : null}
        <Box justifyContent="space-between">
          <Text color="subtle">{`autonomy ${st.autonomy || 'autopilot'}`}</Text>
          {st.awaiting ? <Text color="warning">{`next ⏸ ${st.awaiting}`}</Text> : null}
        </Box>
      </Box>
    )
  })
}
