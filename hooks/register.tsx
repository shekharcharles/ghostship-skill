import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  VOYAGE, STOP_AFTER, parseState, parseBoard, voyageOf, curIndexOf,
  progressBar, statusMark, type GhostshipState, type Task,
} from './state.ts'
import type { VoyageSnap } from '../types'
import type { BandProps } from './band.tsx'

// Ghostship's two live surfaces: the band above the prompt (animated Client on the terminal, one SVG on the
// desktop) and the voyage pane docked right. Both only reflect the skill's own files (docs/ghostship/STATE.md
// + BOARD.md) — no engine, no hidden state. Inert outside a Ghostship project.

const PANE = 'ghostship-voyage'
const STATE_FILE = 'docs/ghostship/STATE.md'
const BOARD_FILE = 'docs/ghostship/BOARD.md'

const snapAtom = atom({ plugin: 'ghostship', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'ghostship', key: 'hidden' } as const, false)

// Module variables reset on reload; the elapsed clock simply restarts, which is fine.
let activeTask: string | null = null
let activeSince: number | null = null
let publishedKey = ''

type Fs = { fs: { read: (p: string) => Promise<string> } }

async function readState($: Fs): Promise<GhostshipState | null> {
  try { return parseState(await $.fs.read(STATE_FILE)) } catch { return null }
}
async function readBoard($: Fs): Promise<Task[]> {
  try { return parseBoard(await $.fs.read(BOARD_FILE)) } catch { return [] }
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

async function publish($: EngineInterface): Promise<void> {
  const st = await readState($)
  const now = await $.clock.now()
  const snap: VoyageSnap = st ? buildSnap(st, now) : { stages: [], curLabel: '', released: false, phase: null, task: null, stop: null, awaiting: false, activeMs: -1, visible: false }
  // Publish on change only; the live clock ticks in the Client between publishes.
  const key = JSON.stringify({ ...snap, activeMs: snap.activeMs >= 0 ? 'run' : 'none' })
  if (key === publishedKey) return
  publishedKey = key
  await update($, snapAtom, () => snap)
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const st = await readState($)
  if (!st || !st.stage) { $.ui.status(undefined); return }
  const i = curIndexOf(st.stage)
  const label = st.stage === 'done' ? 'released' : `${VOYAGE[i]?.label ?? st.stage}${st.task ? ` · ${st.task}` : ''}`
  $.ui.status(`⛴ ${label}`)
}

async function setHidden($: EngineInterface, hidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => hidden)
  try { await $.store.set('hidden', hidden) } catch { /* this session only */ }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    activeTask = null; activeSince = null; publishedKey = ''
    // Each step is guarded on its own, so one failure never stops the band from coming up.
    try { await $.command.register({ name: 'ghostship', description: 'Open the Ghostship voyage pane', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-band', description: 'Ghostship: show or hide the voyage band', immediate: true }) } catch { /* no command */ }
    try { const v = await $.store.get('hidden'); if (typeof v === 'boolean') await update($, hiddenAtom, () => v) } catch { /* nothing stored */ }
    try { await refreshStatus($) } catch { /* no status */ }
    try { await publish($) } catch { /* the render falls back to a direct read */ }
    try { if (e.surface === 'terminal' && await readState($)) void $.ui.open({ id: PANE, title: 'Ghostship' }) } catch { /* no pane */ }
    try { $.clock.every(1500, () => void publish($).catch(() => undefined)) } catch { /* no live refresh */ }
    return started
  })

  on('prompt.submit', async ($, e, next) => { await refreshStatus($); await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => { await refreshStatus($); await publish($); return next(e) }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ghostship' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Ghostship' })
    return { text: 'Ghostship voyage pane opened.' }
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
    if (await read($, hiddenAtom)) return drawn
    // Prefer the published snapshot (it carries the live elapsed); fall back to a direct read so the
    // band shows even before the first publish, or if publishing ever failed.
    let snap = await read($, snapAtom)
    if (!snap || !snap.visible) {
      const st = await readState($)
      snap = st && st.stage ? snapFromState(st, -1) : null
    }
    if (!snap || !snap.visible) return drawn
    const cols = Math.max(24, (e.props.bodyColumns || 80) - 3)

    const { Box, Button, Client } = $.ui.resolve(e)
    const props: BandProps = {
      stages: snap.stages, curLabel: snap.curLabel, released: snap.released,
      phase: snap.phase, task: snap.task, stop: snap.stop, awaiting: snap.awaiting, activeMs: snap.activeMs,
    }
    // Reserve a second row when the full voyage won't fit one line, so wrapped stages aren't clipped.
    const est = 14 + snap.stages.reduce((n, s) => n + 3 + s.label.length, 0) + Math.max(0, snap.stages.length - 1) * 5 + 8 + (snap.task ? 12 : 0)
    const rows = est > cols ? 2 : 1
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="gs-band" flexDirection="row">
          <Client key="gs-band-c" module="./band.tsx" width={cols} height={rows} props={props} />
          <Button key="gs-band-x" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
        </Box>
      </Box>
    )
  })

  // ---- the voyage pane, docked right ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const st = await readState($)
    if (!st || !st.stage) {
      return <Box paddingX={1}><Text color="subtle">Not a Ghostship project yet. Run /ghostship new.</Text></Box>
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

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color="claude" bold>⛴ GHOSTSHIP</Text>
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
            {head('BOARD', `${board.length} TASKS`)}
            {boardRows}
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
        <Box justifyContent="space-between">
          <Text color="subtle">{`autonomy ${st.autonomy || 'autopilot'}`}</Text>
          {st.awaiting ? <Text color="warning">{`next ⏸ ${st.awaiting}`}</Text> : null}
        </Box>
      </Box>
    )
  })
}
