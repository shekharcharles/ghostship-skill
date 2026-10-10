import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  VOYAGE, STOP_AFTER, gateOf, parseState, parseBoard, parseEvidence, setStateField, isUnattended, remainingTasks, voyageOf, curIndexOf,
  progressBar, statusMark, cmpVersion, type GhostshipState, type Task,
} from './state.ts'
import type { VoyageSnap } from '../types'
import { bandTree } from './band.tsx'
import { GS, clock, fmtTokens } from './lib.ts'
import { appEntries, appIdentity } from './overview.ts'
import { fitAgents, roleOf, type Running } from './agents.ts'
import { activityOf, partialArgsOf, thoughtOf, wordsAdded } from './activity.ts'
import { DELETE_REFUSED, riskyDelete } from './guard.ts'
import { WORDMARK, WORDMARK_WIDTH } from './art.ts'
import { capReached, missingForLive } from './state.ts'
import { RUFLO } from './lib.ts'
import {
  addStep, cacheLeft, coldWriteUsd, countdown, endAgent, fmtK, hitRate, keepWarmDue, keepWarmLead, limitsOf, splitSpend, modelLabel, projectTotal,
  refreshVerdict, rowParts, shouldWarn, span, ttlMs, usageUsd,
} from './usage.ts'
import { DEFAULT_ROUTING, ROLES, TIERS, agentLabel, cleanRouting, judgeRetry, modelFor, roleOf as routeRole, taskOf, type Role, type Tier } from './routing.ts'

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
// When the main model last answered: the prompt cache's countdown runs from it. In $.state, so a reload keeps it.
const lastReplyAtAtom = atom({ plugin: 'ghostship', key: 'lastReplyAt' } as const, 0)
const keepWarmAtom = atom({ plugin: 'ghostship', key: 'keepWarm' } as const, null)
const lastRefreshAtom = atom({ plugin: 'ghostship', key: 'lastRefresh' } as const, null)
const cacheTtlAtom = atom({ plugin: 'ghostship', key: 'cacheTtl' } as const, null)
// The cache lifetime the owner picks in the ◆ Ghostship menu; overrides the engine's report, kept across sessions.
const cacheChoiceAtom = atom({ plugin: 'ghostship', key: 'cacheChoice' } as const, null)
const ledgerAtom = atom({ plugin: 'ghostship', key: 'ledger' } as const, [])
const projectUsdAtom = atom({ plugin: 'ghostship', key: 'projectUsd' } as const, null)
// Which model each subagent role runs on; in $.store too, so it holds across sessions.
// Each task's acceptance check (its gate command), read from tasks/T###*.md; in $.state so it is read once per change.
const gatesAtom = atom({ plugin: 'ghostship', key: 'gates' } as const, {} as Record<string, string>)
// Control: the owner can take control back (every agent action is refused until they give it back). The pane's top line shows the
// latest event, and the ACTIONS card the recent actions of the main thread and every agent.
const pausedAtom = atom({ plugin: 'ghostship', key: 'paused' } as const, false)
const eventAtom = atom({ plugin: 'ghostship', key: 'paneEvent' } as const, null as { text: string; tone: 'bad' | 'warn' | 'ok'; at: number } | null)
// The live test's readiness, checked every 30 s: what is still missing, and the spend cap the owner set.
const startupAtom = atom({ plugin: 'ghostship', key: 'startup' } as const, [] as { name: string; ok: boolean; detail: string; at: number }[])
let updateChecked = false
const readinessAtom = atom({ plugin: 'ghostship', key: 'readiness' } as const, null as { missing: string[]; cap: number | null; at: number } | null)
const actionsAtom = atom({ plugin: 'ghostship', key: 'actions' } as const, [] as { id: string; label: string; status: 'run' | 'ok' | 'refused'; at: number }[])
let actionSeq = 0
const PAUSED_REFUSED = 'The owner took control back: nothing is done until they give control back. Stop here and wait; do not continue the task.'
const paneTabAtom = atom({ plugin: 'ghostship', key: 'paneTab' } as const, 'overview')
const routingAtom = atom({ plugin: 'ghostship', key: 'routing' } as const, DEFAULT_ROUTING)

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
// What the main thread (this session) is doing right now, in words; cleared when the turn ends.
// What each agent is doing this moment, by agent id ('main' for this session): the phase the model is in, its thought, its reply
// and the tool call it is writing, as What's Agent Doing (MIT) follows them. Read by the band and the Agents tab.
type Phase = 'idle' | 'requesting' | 'thinking' | 'writing' | 'composing' | 'tool'
type Live = {
  phase: Phase
  thought: string
  isThoughtInWord: boolean
  replyWords: number
  isReplyInWord: boolean
  composing: { tool: string; head: string } | null
  lastAction: string | null
  since: number          // when this phase began ($.clock.now() ms)
  tokens: number         // streamed output in this phase, estimated at 4 characters a token
}
const MAX_INPUT_HEAD = 400
const lives = new Map<string, Live>()
function liveOf(key: string): Live {
  let live = lives.get(key)
  if (!live) {
    live = { phase: 'idle', thought: '', isThoughtInWord: false, replyWords: 0, isReplyInWord: false, composing: null, lastAction: null, since: 0, tokens: 0 }
    lives.set(key, live)
  }
  return live
}
// How long the phase has run and roughly how much it has streamed, after the line: "· 12s · 250 tokens".
function clockOf(live: Live, nowMs: number): string {
  if (live.since <= 0 || (live.phase !== 'thinking' && live.phase !== 'writing')) return ''
  const secs = Math.max(0, Math.round((nowMs - live.since) / 1000))
  return ` · ${secs}s · ${live.tokens >= 1000 ? `${(live.tokens / 1000).toFixed(1)}k` : live.tokens} tokens`
}
// The line that says what an agent is doing this moment, in What's Agent Doing's words.
function doingOf(live: Live): string | null {
  switch (live.phase) {
    case 'requesting': return 'Waiting for the model'
    case 'thinking': {
      const snippet = thoughtOf(live.thought, THOUGHT_CHARS)
      return snippet ? `Thinking: ${snippet}` : live.lastAction ?? 'Waiting for the model'
    }
    case 'writing': return `Writing the reply · ${live.replyWords} word${live.replyWords === 1 ? '' : 's'}`
    case 'composing': return live.composing ? activityOf(live.composing.tool, partialArgsOf(live.composing.head)) : 'Writing a tool call'
    default: return live.lastAction
  }
}
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
// The thought shown in full: up to this many characters, wrapped onto the band's rows rather than cut.
const THOUGHT_CHARS = 400
// A line cut into rows of `width` characters, the newest `max` rows kept (a leading … when more is cut).
function rowsOf(text: string, width: number, max: number): string[] {
  const all: string[] = []
  for (let i = 0; i < text.length; i += width) all.push(text.slice(i, i + width))
  if (all.length <= max) return all
  const kept = all.slice(all.length - max)
  kept[0] = `…${kept[0]!.slice(1)}`
  return kept
}
// Rows kept for other mods' bands drawn above ours (What's Agent Doing's box is 3).
const OTHER_MOD_ROWS = 4
// A verdict shows on the band this long after it lands; the spinner's frames, one a second.
const NOTICE_MS = 20_000
// A dotted spinner that circles while something runs (builders, judges, the main thread, a task being built).
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// Frames advance every 100 ms, so the dots turn smoothly; the pane redraws that often only while work runs.
const SPIN_MS = 100

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
// The GHOSTSHIP wordmark, three coloured rows centred in the space it is given.
function wordmark(ui: any, key: string): any {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="column" alignItems="center">
      {WORDMARK.map((row, i) => (
        <Text key={`${key}-${i}`} bold>{row.map((seg, j) => <Text key={`${key}-${i}-${j}`} color={seg.color}>{seg.text}</Text>)}</Text>
      ))}
    </Box>
  )
}

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

// The last state read with a real stage. The orchestrator rewrites STATE.md often; a read caught mid-write comes back empty
// and would parse to no stage, flashing "no project" in the band. Keep the last good one until the file is actually gone.
let lastState: GhostshipState | null = null
async function readState($: Fs): Promise<GhostshipState | null> {
  let text: string
  try { text = await $.fs.read(STATE_FILE) } catch { lastState = null; return null }
  const st = parseState(text)
  if (st.stage) { lastState = st; return st }
  return lastState ?? st
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

// A project still on the engine edition keeps its state in .ghostship/, not docs/ghostship/: the views say how to move it over.
let legacyEngine = false
const LEGACY_HINT = 'this project runs the old Ghostship engine · type /ghostship:ghostship adopt to move it to this plugin'

let gatesKey = ''
// Reads each task file's gate line when the set of task files changes; a redraw never re-reads them.
async function loadGates($: EngineInterface): Promise<void> {
  let names: string[] = []
  try { names = (await $.fs.list('tasks')).filter(f => f.kind !== 'dir' && /^T\d+.*\.md$/.test(f.name)).map(f => f.name).sort() } catch { return }
  const key = names.join('|')
  if (key === gatesKey) return
  const gates: Record<string, string> = {}
  for (const name of names) {
    const id = name.match(/^(T\d+)/)?.[1]
    if (!id) continue
    const gate = gateOf(await tryRead($, `tasks/${name}`) ?? '')
    if (gate) gates[id] = gate
  }
  gatesKey = key
  await update($, gatesAtom, () => gates)
}

async function publish($: EngineInterface): Promise<void> {
  const st = await readState($)
  if (st) await loadGates($).catch(() => undefined)
  legacyEngine = !st && (await tryList($)).some(f => f.name === '.ghostship')
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
// The newest published version, read from the repository's manifest. Tries the engine's own fetch first, then curl; a failure
// carries its reason, so "could not check" is never mistaken for "up to date".
async function latestVersion($: EngineInterface): Promise<string> {
  let why = ''
  try {
    const r = await $.http.fetch(RAW_MANIFEST)
    if (r.ok) return JSON.parse(r.text).version as string
    why = `GitHub answered ${r.status}`
  } catch (err) { why = (err as Error).message }
  const res = await $.process.run(['curl', '-fsSL', '-m', '8', RAW_MANIFEST])
  if (res.exitCode !== 0 || !res.stdout) throw new Error(`${why || 'no answer'}; curl exit ${res.exitCode}${res.stderr ? `: ${res.stderr.trim().slice(0, 120)}` : ''}`)
  return JSON.parse(res.stdout).version as string
}

// Compares the installed version with the newest; the result says which, or why the check could not run.
async function checkUpdate($: EngineInterface): Promise<{ latest?: string; installed?: string; error?: string }> {
  let installed = ''
  try {
    installed = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version as string
    const latest = await latestVersion($)
    const newer = !!installed && !!latest && cmpVersion(latest, installed) > 0
    await update($, updateAtom, () => (newer ? { latest } : null))
    updateChecked = true
    return newer ? { latest, installed } : { installed }
  } catch (err) {
    await update($, updateAtom, () => null)
    return { installed, error: (err as Error).message }
  }
}

// One-click update: refresh the marketplace and update the plugin, then ask for a restart to apply.
// Set once the new version is downloaded and waiting to be applied; the reload holds until the build is idle.
let reloadPending = false
function buildBusy(): boolean {
  return working || running.size > 0
}

// Reload the plugin so the downloaded version takes effect, without killing the build (the turn and subagents are the engine's,
// not the plugin's). If the engine will not run the command for a mod, fall back to asking the owner to reload.
async function applyUpdate($: EngineInterface): Promise<void> {
  reloadPending = false
  try {
    await $.command.run({ command: 'reload-plugins' })
    $.ui.toast('Ghostship updated and reloaded — your build kept running.')
  } catch {
    $.ui.toast('Ghostship is downloaded. Run /reload-plugins to apply it (your build keeps running); or restart later.')
  }
}

// The menu's "Check for update": look now and say what was found, or why it could not look.
async function checkNow($: EngineInterface): Promise<void> {
  $.ui.toast('Ghostship: checking for an update…')
  const r = await checkUpdate($)
  if (r.error) $.ui.toast(`Could not check for an update: ${r.error}`)
  else if (r.latest) $.ui.toast(`Ghostship ${r.latest} is available (you have ${r.installed}). Click Update.`)
  else $.ui.toast(`Ghostship ${r.installed} is the newest version.`)
}

// Runs the Claude CLI for the update. The engine's runner may not have the usual PATH, so the CLI is also tried at its install path
// (~/.local/bin/claude); the result is the first that runs, so a missing CLI shows its own error.
async function claudeCli($: EngineInterface, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const bins = ['claude', ...(home ? [`${home}/.local/bin/claude`] : [])]
  let last = { exitCode: 127, stdout: '', stderr: 'claude not found' }
  for (const bin of bins) {
    try {
      const r = await $.process.run([bin, ...args], { timeoutMs: 120000 })
      if (r.exitCode !== 127) return r
      last = r
    } catch (err) { last = { exitCode: 127, stdout: '', stderr: (err as Error).message } }
  }
  return last
}

async function doUpdate($: EngineInterface): Promise<void> {
  try {
    $.ui.toast('Ghostship: downloading the update…')
    await claudeCli($, ['plugin', 'marketplace', 'update', MARKET])
    const r = await claudeCli($, ['plugin', 'update', PLUGIN])
    if (r.exitCode !== 0) {
      $.ui.toast(`Ghostship update failed: ${(r.stderr || r.stdout || 'unknown').trim().slice(0, 160)}`)
      return
    }
    await update($, updateAtom, () => null)
    // The download never interrupts the build; the reload waits until nothing is running.
    if (buildBusy()) {
      reloadPending = true
      $.ui.toast('Ghostship downloaded — it applies the moment the current work finishes. The build keeps running.')
    } else {
      await applyUpdate($)
    }
  } catch (e) {
    $.ui.toast(`Ghostship update error: ${(e as Error).message}`)
  }
}

// ---- the band's usage line: context, the prompt-cache countdown, the 5-hour and weekly limits ----
// The engine does not report the cache's expiry, so the countdown runs from the main model's last reply: each request
// restarts the cache's lifetime, which the cacheTtl setting names (5 minutes on most accounts, an hour on some).
const WARN_LEAD_MS = 60_000
let contextPct: number | null = null
let limits: ReturnType<typeof limitsOf> = { fiveHour: null, week: null }
let tokens: number | undefined
let windowSize: number | undefined
let usd: number | null = null
// From the main model's last reply: which model answered, and how much of its input the cache served.
let lastModel: string | null = null
let lastHit: number | null = null
let working = false
let warnedFor = 0

// The cache lifetime for the countdown: the owner's menu choice wins, else the engine's last model-switch report, else 1h
// (a Claude subscription; pick 5m in the menu on an API key).
async function ttlNow($: EngineInterface): Promise<number> {
  return ttlMs((await read($, cacheChoiceAtom)) ?? (await read($, cacheTtlAtom)) ?? '1h')
}
// The owner's cache-lifetime choice from the menu, kept across sessions.
async function setCacheChoice($: EngineInterface, value: '5m' | '1h'): Promise<void> {
  await update($, cacheChoiceAtom, () => value)
  try { await $.store.set('cacheChoice', value) } catch { /* not persisted */ }
  $.ui.toast(`Cache lifetime set to ${value === '1h' ? '1 hour' : '5 minutes'} for the countdown.`)
}

// Each second: the latest usage figures, keep-warm when its window is open, the cold-cache warning a minute ahead, a redraw.
async function usageTick($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    contextPct = u.context.percent ?? null
    tokens = u.context.tokens
    windowSize = u.context.window
    usd = u.cost?.usd ?? null
    limits = limitsOf(u.rateLimits)
    const cap = (await read($, readinessAtom))?.cap ?? null
    if (capReached(usd, cap) && !(await read($, pausedAtom))) {
      await setPaused($, true)
      await noteEvent($, `Spend cap reached: $${(usd ?? 0).toFixed(2)} of $${cap}. Control is taken back. Raise the cap in STATE.md, then give control back.`, 'bad')
    }
  } catch { /* no reading yet */ }
  const ttl = await ttlNow($)
  const now = await $.clock.now()
  const keep = await read($, keepWarmAtom)
  if (keep && keep.until <= now) await update($, keepWarmAtom, () => null)
  const last = await read($, lastReplyAtAtom)
  const left = cacheLeft(now, last, ttl)
  if (keep && !refreshing && keepWarmDue({ nowMs: now, until: keep.until, left, ttl, working })) void refreshCache($, { keep: true })
  if (!working && shouldWarn(left, WARN_LEAD_MS, warnedFor, last)) {
    warnedFor = last
    $.ui.toast(`Prompt cache goes cold in ${countdown(left!)}: press ↻ cache in the Ghostship band, or send a message, to keep it warm.`)
  }
  $.ui.invalidate('ui.render')
}

let refreshing = false
// ↻ cache, and keep-warm's refresh: one tiny question over the cached prefix, which restarts its lifetime. The reply's usage says
// whether the cache was still warm (a read, and under a tenth of it written again) or had gone and was written again.
async function refreshCache($: EngineInterface, opts: { keep?: boolean } = {}): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const ttl = await ttlNow($)
    const r = await $.model.fork({ prompt: 'Reply with the single word OK.' })
    if (!r.isAnswered) {
      if (opts.keep) await update($, keepWarmAtom, () => null)
      $.ui.toast(r.reason === 'nothing-to-fork' ? 'No conversation to keep warm yet.' : `Could not refresh the prompt cache (${r.reason}).${opts.keep ? ' Keep warm is off.' : ''}`)
      return
    }
    const now = await $.clock.now()
    await update($, lastReplyAtAtom, () => now)
    const v = refreshVerdict(r.usage, lastModel, ttl)
    await update($, lastRefreshAtom, () => ({ at: now, ...v }))
    const cost = v.usd === null ? '' : ` · $${v.usd.toFixed(2)}`
    if (opts.keep && !v.warm) await update($, keepWarmAtom, () => null)
    if (v.warm) $.ui.toast(`${opts.keep ? 'Kept warm' : 'Prompt cache kept warm'}: read ${fmtK(v.read)} tokens${cost}, warm for ${countdown(ttl)}.`)
    else $.ui.toast(`${opts.keep ? 'Keep warm stopped: the cache had gone cold' : 'The prompt cache had gone cold'}: written again, ${fmtK(v.write)} tokens${cost}. Warm for ${countdown(ttl)} now.`)
  } catch (err) {
    if (opts.keep) await update($, keepWarmAtom, () => null)
    $.ui.toast(`Could not refresh the prompt cache: ${(err as Error).message}`)
  } finally {
    refreshing = false
  }
}

// The pane's ROUTING card: one role's model, kept for this session and the next.
async function setRouting($: EngineInterface, role: Role, tier: Tier): Promise<void> {
  const next = { ...(await read($, routingAtom)), [role]: tier }
  await update($, routingAtom, () => next)
  await $.store.set('routing', next)
}

// Keep warm: a window of 1h or 2h, or off. The refresh itself runs from the tick, a sixth of the cache's lifetime before cold.
async function setKeepWarm($: EngineInterface, hours: number): Promise<void> {
  const now = await $.clock.now()
  await update($, keepWarmAtom, () => (hours ? { until: now + hours * 3_600_000, hours } : null))
  $.ui.toast(hours ? `Keep warm on for ${hours}h: the cache is refreshed before it goes cold; each refresh is one small request.` : 'Keep warm off.')
}

// Whether the live test can run: the provider's key is set, the lab answers and a spend cap is set. Checked every 30 s, not on each redraw.
async function checkReadiness($: EngineInterface): Promise<void> {
  const st = await readState($)
  const board = await readBoard($)
  const at = await $.clock.now()
  if (!st || !st.stage) {
    await update($, readinessAtom, () => null)
    await update($, startupAtom, () => [{ name: 'Project state', ok: false, detail: 'no project in this folder', at }])
    return
  }
  let hasKey = false
  // The key's name comes from STATE.md; only a plain variable name is checked, and it is passed as an argument, never through a shell.
  if (st.providerEnv && /^[A-Z_][A-Z0-9_]*$/.test(st.providerEnv)) {
    try { hasKey = (await $.process.run(['printenv', st.providerEnv])).exitCode === 0 } catch { hasKey = false }
  }
  let labOk: boolean | null = null
  if (st.labUrl) { try { labOk = (await $.http.fetch(st.labUrl)).status < 500 } catch { labOk = false } }
  const missing = missingForLive(st, { hasKey, labOk })
  await update($, readinessAtom, () => ({ missing, cap: st.spendCapUsd, at }))
  await update($, startupAtom, () => [
    { name: 'Project state', ok: true, detail: `stage ${st.stage}`, at },
    { name: 'Board', ok: board.length > 0, detail: `${board.length} tasks`, at },
    { name: 'Live test', ok: missing.length === 0, detail: missing.length ? `${missing.length} missing` : 'ready', at },
    { name: 'Usage reading', ok: contextPct !== null, detail: contextPct !== null ? `${Math.round(contextPct)}% of context` : 'waiting for the first reading', at },
    { name: 'Update check', ok: updateChecked, detail: !updateChecked ? 'not yet' : updateAtom ? 'a newer version is out' : 'up to date', at },
  ])
}

// The one line at the top of the pane: the latest event, and what it means.
async function noteEvent($: EngineInterface, text: string, tone: 'bad' | 'warn' | 'ok'): Promise<void> {
  const at = await $.clock.now()
  await update($, eventAtom, () => ({ text, tone, at }))
}

// One entry in the ACTIONS card: it runs, then ends as done or refused.
async function startAction($: EngineInterface, id: string, label: string): Promise<void> {
  const at = await $.clock.now()
  const list = await read($, actionsAtom)
  await update($, actionsAtom, () => [...list, { id, label, status: 'run' as const, at }].slice(-12))
}
async function endAction($: EngineInterface, id: string, status: 'ok' | 'refused'): Promise<void> {
  const list = await read($, actionsAtom)
  await update($, actionsAtom, () => list.map(a => (a.id === id ? { ...a, status } : a)))
}

// Take control back, or give it back. Giving it back puts the resume command in the prompt for the owner to send.
async function setPaused($: EngineInterface, paused: boolean): Promise<void> {
  await update($, pausedAtom, () => paused)
  if (paused) {
    await noteEvent($, 'Control is taken back: every agent action is refused until you give it back.', 'warn')
    $.ui.toast('Control taken back: the agents stop acting. Give it back to continue the build.')
  } else {
    await noteEvent($, 'Control is given back: send /ghostship:ghostship resume to continue the build.', 'ok')
    await $.prompt.fill({ text: `/${SKILL_COMMAND} resume` }).catch(() => undefined)
  }
}

// The project's spend: each session's cost under its id, kept in $.store by project folder, so the band shows every session together.
let projectKey = ''
let sessionId = ''
async function recordSpend($: EngineInterface): Promise<void> {
  if (!projectKey || !sessionId) return
  let usdNow = usd
  try { usdNow = (await $.session.usage()).cost?.usd ?? null } catch { /* keep the last reading */ }
  // Without the engine's figure, the ledger's list-price estimate stands in.
  const session = usdNow ?? (await read($, ledgerAtom)).reduce((s, a) => s + a.usd, 0)
  // shortcut: two sessions of one project writing at once can lose one write; a per-session key would fix it if that shows up.
  const stored = await $.store.get(projectKey)
  const bySession = { ...(stored && typeof stored === 'object' ? stored as Record<string, number> : {}), [sessionId]: session }
  await $.store.set(projectKey, bySession)
  await update($, projectUsdAtom, () => projectTotal(bySession))
}

// ---- keeping the build going: after STOP 1 (through release) the owner is never asked, and the turn does not end ----
// The skill says so; these two hooks hold it to that. A question is refused with the way to park it instead, and a turn
// that tries to end while tasks remain is sent back to the next one, up to MAX_NUDGES times without progress on disk.
const MAX_NUDGES = 3
let nudges = 0
let lastProgress = ''
const ASK_REFUSED = 'Ghostship is running unattended (after STOP 1, through release), so the owner is not asked now. ' +
  'Park it instead: set the task to parked in BOARD.md, add the question with the options and your recommended answer to ' +
  'docs/ghostship/DECISIONS.md with the recommended answer applied, and go on with the next ready task. Decisions are listed in the release report, not asked.'

async function buildStatus($: Fs): Promise<{ unattended: boolean; left: Task[]; progress: string }> {
  const stateText = await tryRead($, STATE_FILE)
  const boardText = await tryRead($, BOARD_FILE)
  return {
    unattended: isUnattended(stateText ? parseState(stateText) : null),
    left: remainingTasks(boardText ? parseBoard(boardText) : []),
    progress: `${stateText}\n${boardText}`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try { const c = await $.store.get('cacheChoice'); if (c === '5m' || c === '1h') await update($, cacheChoiceAtom, () => c) } catch { /* no stored choice */ }
    activeTask = null; activeSince = null; publishedKey = ''; stamps = []; stamped = false; lastState = null
    try { await readVersion($) } catch { /* unknown version */ }
    try { await seedSpend($) } catch { /* no spend */ }
    // Each step is guarded on its own, so one failure never stops the band from coming up.
    try { await $.command.register({ name: 'ghostship', description: 'Open the Ghostship pane', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-band', description: 'Ghostship: show or hide the voyage band', immediate: true }) } catch { /* no command */ }
    try { await $.command.register({ name: 'ghostship-update', description: 'Ghostship: check for and install the latest version', immediate: true }) } catch { /* no command */ }
    try { const r = cleanRouting(await $.store.get('routing')); await update($, routingAtom, () => r) } catch { /* the default routing */ }
    try { const v = await $.store.get('hidden'); if (typeof v === 'boolean') await update($, hiddenAtom, () => v) } catch { /* nothing stored */ }
    // The band above the prompt is the only live line; clear any status line an older version pinned.
    try { $.ui.status(undefined) } catch { /* no status line */ }
    try { await publish($) } catch { /* the render falls back to a direct read */ }
    // Versions before 0.4.7 opened a second pane, the Overview; it is folded into the one pane now, so close any left open.
    try { await $.ui.close({ id: 'ghostship-overview' }) } catch { /* none open */ }
    // Live refresh: the snapshot every 1.5 s, and a redraw of the band and panes every second.
    try { $.clock.every(1500, () => { ticks += 1; if (ticks % 6 === 1) void readBranch($).catch(() => undefined); void publish($).catch(() => undefined) }) } catch { /* no live refresh */ }
    try { $.clock.every(1000, () => void usageTick($).catch(() => undefined)) } catch { /* no redraw timer */ }
    void checkReadiness($).catch(() => undefined)
    try { $.clock.every(30_000, () => void checkReadiness($).catch(() => undefined)) } catch { /* no readiness check */ }
    try { $.clock.every(SPIN_MS, () => { if (buildBusy()) $.ui.invalidate('ui.render') }) } catch { /* no spinner */ }
    // The project's spend so far, every session together; this session adds itself after each turn.
    try {
      projectKey = `spend:${e.cwd}`
      sessionId = await $.session.id()
      const stored = await $.store.get(projectKey)
      await update($, projectUsdAtom, () => projectTotal(stored && typeof stored === 'object' ? stored as Record<string, number> : {}))
    } catch { /* no project spend */ }
    // Check GitHub for a newer version now and every 30 minutes, so an update appears in the band without a restart.
    const announce = async () => { const u = await read($, updateAtom); if (u) $.ui.toast(`Ghostship ${u.latest} is available — click Update above the prompt, or /ghostship-update`) }
    void checkUpdate($).then(announce).catch(() => undefined)
    try { $.clock.every(30 * 60_000, () => void checkUpdate($).then(announce).catch(() => undefined)) } catch { /* no periodic check */ }
    return started
  })

  on('prompt.submit', async ($, e, next) => { await publish($); return next(e) }).catch(($, e, next) => next(e))
  on('turn.start', async ($, e, next) => { working = true; return next(e) }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    working = false
    liveOf('main').lastAction = null
    liveOf('main').phase = 'idle'
    const now = await $.clock.now()
    // The turn's end, in the owner's words: how long it took and what it cost so far.
    if (!e.agentId) {
      const secs = Math.max(0, Math.round(e.durationMs / 1000))
      const took = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
      $.ui.toast(`Turn done in ${took}${usd !== null ? ` · $${usd.toFixed(2)} this session` : ''}.`)
    }
    await update($, lastReplyAtAtom, () => now)
    await publish($)
    await recordSpend($).catch(() => undefined)
    // A downloaded update waits for a quiet moment; apply it now that the turn is done and nothing is running.
    if (reloadPending && running.size === 0) await applyUpdate($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))
  // Every reply of the main model restarts the prompt cache's lifetime; subagents keep caches of their own.
  // Each step, the main thread's or a subagent's, adds its tokens and list-price cost to the ledger the pane shows.
  on('turn.step', async function* ($, e, next) {
    // The model's stream, followed chunk by chunk into this agent's live state, and passed on unchanged.
    const live = liveOf(e.agentId ?? 'main')
    Object.assign(live, { phase: 'requesting', thought: '', isThoughtInWord: false, replyWords: 0, isReplyInWord: false, composing: null, since: await $.clock.now(), tokens: 0 })
    const piece = next(e)
    let result
    for (;;) {
      const step = await piece.next()
      if (step.done) { result = step.value; break }
      const c = step.value
      if (c.kind === 'thinking' || c.kind === 'text') live.tokens += Math.ceil(c.text.length / 4)
      if (c.kind === 'thinking') {
        if (live.phase !== 'thinking') { live.phase = 'thinking'; live.since = await $.clock.now(); live.tokens = Math.ceil(c.text.length / 4) }
        live.thought = (live.thought + c.text).slice(-2000)
      } else if (c.kind === 'text') {
        if (live.phase !== 'writing') { live.phase = 'writing'; live.since = await $.clock.now(); live.tokens = Math.ceil(c.text.length / 4) }
        const w = wordsAdded(c.text, live.isReplyInWord)
        live.replyWords += w.added
        live.isReplyInWord = w.isInWord
      } else if (c.kind === 'tool') {
        live.phase = 'composing'
        live.composing = { tool: c.name, head: '' }
      } else if (c.kind === 'input' && live.composing && live.composing.head.length < MAX_INPUT_HEAD) {
        live.composing.head += c.json
      }
      yield c
    }
    if (!live.composing) live.phase = 'idle'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = result.usage as any
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      await update($, lastReplyAtAtom, () => now)
      lastModel = usage?.model ?? e.model
      lastHit = hitRate(usage)
    }
    if (usage) {
      const id = e.agentId ?? 'main'
      const model = usage.model ?? e.model ?? null
      const usdStep = usageUsd(usage, model, await ttlNow($))
      const name = id === 'main' ? 'Main thread' : running.get(id)?.name ?? 'Agent'
      const list = await read($, ledgerAtom)
      await update($, ledgerAtom, () => addStep(list, { id, name, model, usage, usd: usdStep, nowMs: now }))
    }
    return result
  })

  // The cache's lifetime, when the engine says it: a model switch carries it.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const r = await next(e)
    if (e.cache_ttl === '5m' || e.cache_ttl === '1h') await update($, cacheTtlAtom, () => e.cache_ttl)
    return r
  }).catch(($, e, next) => next(e))

  // A resumed session: the countdown runs from the transcript's last reply, and a cold resume says what its first message costs.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear') {
      await update($, lastReplyAtAtom, () => 0)
      await update($, keepWarmAtom, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      await update($, lastReplyAtAtom, () => Math.max(1, now - e.seconds_since_last_response! * 1000))
      if (e.model) lastModel = e.model
      if (e.prompt_cache_likely_expired && e.context_tokens) {
        const price = typeof e.estimated_cache_write_usd === 'number' ? e.estimated_cache_write_usd : coldWriteUsd(lastModel, e.context_tokens, await ttlNow($))
        $.ui.toast(`Resuming cold: the first message writes ${fmtK(e.context_tokens)} tokens to the cache again${price != null ? `, about $${price.toFixed(2)}` : ''}. /clear and paste a summary if only the conclusions matter.`)
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await buildStatus($)).unattended) return next(e)
    await noteEvent($, 'Refused a question: the build runs unattended, so the item is parked for the release report.', 'bad')
    return { deny: ASK_REFUSED }
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    if (await read($, pausedAtom)) return next(e)
    const b = await buildStatus($)
    if (!b.unattended || !b.left.length) { nudges = 0; return next(e) }
    if (b.progress !== lastProgress) { lastProgress = b.progress; nudges = 0 }
    if (nudges >= MAX_NUDGES) {
      $.ui.toast(`Ghostship let the turn end: ${MAX_NUDGES} nudges brought no progress on the board. Check the build, then /ghostship:ghostship resume.`)
      return next(e)
    }
    nudges += 1
    const first = b.left[0]!
    return {
      block: `Ghostship's build is not finished: ${b.left.length} task(s) remain, next ${first.id} (${first.label}). ` +
        'Do not stop and do not ask the owner. Continue with the next ready task now; anything you cannot resolve is parked ' +
        'with its reason in BOARD.md and DECISIONS.md; it is applied automatically and listed in the release report.',
    }
  }).catch(($, e, next) => next(e))
  on('session.measure', async ($, e, next) => { const r = await next(e); try { await update($, spendAtom, () => toSpend(e as any)) } catch { /* ignore */ } return r }).catch(($, e, next) => next(e))

  // ---- subagent rows: the builder, the judge and any other subagent, each with its current step ----
  // Smart routing: each subagent runs on its role's model (search and reading on Haiku, building and judging on Sonnet, unless
  // the ROUTING card says otherwise). A fork shares the main thread's conversation and model, so it is left alone.
  // A judge whose task already failed once goes to Opus: a retry is the hard case, where a weak verdict costs another round.
  on('agent.spawn', async ($, e, next) => {
    const role = routeRole(e.subagentType, e.name, e.description)
    const retry = role === 'judge' && judgeRetry(
      taskOf(`${e.name ?? ''} ${e.description}`),
      (await read($, ledgerAtom)).map(a => a.name),
      (await read($, evidenceAtom)).filter(v => v.verdict === 'fail').map(v => v.task),
    )
    const routed = e.fork ? undefined : retry ? 'claude-opus-5-5' : modelFor(await read($, routingAtom), role)
    const result = await next(routed ? { ...e, model: routed } : e)
    if (result.agentId !== undefined) {
      // Named for its role and task, with the task's title from BOARD.md, so the list says what it is building.
      const id = taskOf(`${e.name ?? ''} ${e.description}`)
      const board = id ? parseBoard((await tryRead($, BOARD_FILE)) ?? '') : []
      const title = board.find(t => t.id === id)?.name || board.find(t => t.id === id)?.label
      const shown = agentLabel(role, id, title, retry, e.description || e.name || 'Agent')
      const startMs = await $.clock.now()
      running.set(result.agentId, { name: shown, label: 'Getting started', startMs })
      // The ledger lists the agent from its spawn, before its first step has cost anything.
      const list = await read($, ledgerAtom)
      await update($, ledgerAtom, () => [...list, { id: result.agentId!, name: shown, model: result.model ?? routed ?? null, running: true, startMs, endMs: null, input: 0, output: 0, steps: 0, usd: 0 }])
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = `a${++actionSeq}`
    const step = activityOf(e.tool, e as unknown as Record<string, unknown>)
    const who = e.agentId !== undefined ? (running.get(e.agentId)?.name.split(' · ')[0] ?? 'Agent') : 'Main thread'
    // Control taken back: no action goes through, from the main thread or any agent.
    if (await read($, pausedAtom)) {
      await noteEvent($, `Refused ${who}: ${step}. Control is taken back.`, 'bad')
      await startAction($, id, `${who}: ${step}`)
      await endAction($, id, 'refused')
      return { deny: PAUSED_REFUSED }
    }
    // A delete that could remove more than it names is refused at once: the agent gets the reason and goes on, nothing waits.
    if (e.tool === 'Bash' && riskyDelete(String((e as unknown as { input?: { command?: unknown } }).input?.command ?? ''))) {
      await noteEvent($, `Refused ${who}: a delete that could remove more than it names.`, 'bad')
      await startAction($, id, `${who}: ${step}`)
      await endAction($, id, 'refused')
      return { deny: DELETE_REFUSED }
    }
    const live = liveOf(e.agentId ?? 'main')
    live.phase = 'tool'
    live.composing = null
    live.lastAction = step
    if (e.agentId !== undefined) { const a = running.get(e.agentId); if (a) a.label = step }
    await startAction($, id, `${who}: ${step}`)
    const r = await next(e)
    await endAction($, id, (r as { deny?: unknown }).deny !== undefined ? 'refused' : 'ok')
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    running.delete(e.agent_id)
    const now = await $.clock.now()
    const list = await read($, ledgerAtom)
    await update($, ledgerAtom, () => endAgent(list, e.agent_id, now))
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
    const t = Math.floor(nowMs / SPIN_MS)

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
      const ttlChoice = (await read($, cacheChoiceAtom)) ?? (await read($, cacheTtlAtom)) ?? '1h'
      const paused = await read($, pausedAtom)
      const pIn = !!pst?.stage
      const pBoard = pIn ? await readBoard($) : []
      const pDone = pBoard.filter(t => t.status === 'done' || t.status === 'merged').length
      const pCur = pIn ? curIndexOf(pst!.stage) : -1
      const where = !pIn ? 'no project here' : pst!.stage === 'done' ? 'Released' : `${VOYAGE[pCur]?.label ?? pst!.stage}${pBoard.length ? ` · ${pDone}/${pBoard.length}` : ''}`
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
      const panelWidth = Math.min(76, Math.max(40, (e.props.bodyColumns || 80) - 2))
      const artOn = panelWidth >= WORDMARK_WIDTH + 4 && room >= 1 + (pIn ? 2 : 1) + 2 + 1 + WORDMARK.length + 4
      const base = 1 + (pIn ? 2 : 1) + 2 + 1 + (artOn ? WORDMARK.length : 0)
      const withHeads = room >= base + 2 + 2
      const pBordered = room >= base + (withHeads ? 2 : 0) + 2
      const rows: any[] = [
        ...(artOn ? [wordmark(ui, 'p-art')] : []),
        <Box key="p-head" flexDirection="row" justifyContent="space-between">
          {artOn ? <Box /> : <Text bold color={GS.clay}>◆  G H O S T S H I P</Text>}
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
          : [<Text key="p-none" dimColor>Start a project (/ghostship new) to pick the build mode and autonomy.</Text>]),
        withHeads ? heading('p-sh', 'S E T T I N G S') : null,
        setting('p-band', 'Band', 'the voyage line above the prompt', !hidden, [
          chip('p-b-on', 'On', !hidden, () => void setHidden($, false)),
          chip('p-b-off', 'Off', hidden, () => void setHidden($, true)),
        ]),
        setting('p-ctl', 'Control', 'whether the agents may act', !paused, [
          chip('p-c-run', 'Running', !paused, () => void setPaused($, false)),
          chip('p-c-hold', 'Taken back', paused, () => void setPaused($, true)),
        ]),
        setting('p-pane', 'Pane', 'the Ghostship pane on the right', paneUp, [
          chip('p-p-open', 'Open', paneUp, () => void setPane($, true)),
          chip('p-p-min', 'Minimized', !paneUp, () => void setPane($, false)),
        ]),
        setting('p-cache', 'Cache', 'how long the prompt cache stays warm (the countdown)', true, [
          chip('p-c-5m', '5m', ttlChoice === '5m', () => void setCacheChoice($, '5m')),
          chip('p-c-1h', '1h', ttlChoice === '1h', () => void setCacheChoice($, '1h')),
        ]),
        <Box key="p-upd-row" flexDirection="row" justifyContent="space-between" gap={1}>
          <Box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
            <Text color={upd ? GS.amber : GS.subtle}>{upd ? '⬆' : '●'}</Text>
            <Text bold>Updates</Text>
            <Text dimColor wrap="truncate-end">{upd ? `v${upd.latest} is available` : `v${installedVersion ?? '…'} — the newest`}</Text>
          </Box>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {upd
              ? <Button key="p-upd-go" label=" Update " variant="primary" onPress={() => void doUpdate($)} />
              : <Button key="p-upd-chk" label=" Check for update " plain dimColor onPress={() => void checkNow($)} />}
          </Box>
        </Box>,
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
        const width = panelWidth
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
            <Box flexShrink={0}><Text color={GS.clay} bold>{`Ghostship${installedVersion ? ` v${installedVersion}` : ''}`}</Text></Box>
            <Text dimColor wrap="truncate-end">{legacyEngine ? LEGACY_HINT : 'no Ghostship project in this folder · type /ghostship new to start a project'}</Text>
            {branch ? <Box flexShrink={0}><Text color={GS.subtle}>{`⎇ ${branch}`}</Text></Box> : null}
          </Box>
        )
      const rows: unknown[] = [<Box key="gs-head" flexDirection="row" justifyContent="space-between">{head}{hide}</Box>]
      let room = budget - used - (bordered ? 3 : 1)
      const bandWidth = Math.max(24, (e.props.bodyColumns || 80) - 10)

      // The usage line: context, the cache countdown with ↻ cache to refresh it, the 5-hour and weekly limits.
      if (room >= 1) {
        const ttl = await ttlNow($)
        const keep = await read($, keepWarmAtom)
        const parts = rowParts({
          model: lastModel, contextPct, tokens, window: windowSize, working, leadMs: WARN_LEAD_MS,
          fiveHour: limits.fiveHour, fiveHourResetsAt: limits.fiveHourResetsAt, week: limits.week,
          cacheLeftMs: cacheLeft(nowMs, await read($, lastReplyAtAtom), ttl), hitPct: lastHit, usd, nowMs: Date.now(),
          coldUsd: coldWriteUsd(lastModel, tokens, ttl), keepWarmLeftMs: keep ? keep.until - nowMs : 0,
          projectUsd: await read($, projectUsdAtom),
        })
        const look = (tone: string) => tone === 'dim' ? { dimColor: true }
          : tone === 'model' ? { color: GS.clay, bold: true }
          : { color: tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : 'error' }
        rows.push(
          <Box key="gs-usage" flexDirection="row" justifyContent="space-between" gap={1}>
            <Text wrap="truncate-end">
              {parts.flatMap((p, i) => [
                i ? <Text key={`us${i}`} dimColor>{'  ·  '}</Text> : null,
                <Text key={`up${i}`} {...look(p.tone)}>{p.text}</Text>,
              ])}
            </Text>
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Button key="gs-cache" label=" ↻ cache " plain dimColor onPress={() => void refreshCache($)} />
            </Box>
          </Box>,
        )
        room -= 1
      }

      // What the main thread is doing right now, one line under the usage, while a turn runs: thinking, writing, a call, a tool.
      const doing = working ? `${doingOf(liveOf('main')) ?? ''}${clockOf(liveOf('main'), nowMs)}` : null
      if (doing && room >= 1) {
        const lines = rowsOf(`Main thread › ${doing}`, bandWidth, Math.min(3, room))
        lines.forEach((line, i) => rows.push(
          <Box key={`gs-think${i}`} flexDirection="row">
            {i === 0
              ? <Text wrap="truncate-end"><Text color={GS.green}>{`${SPIN[Math.floor(nowMs / SPIN_MS) % SPIN.length]} `}</Text><Text color={GS.mist}>{line}</Text></Text>
              : <Text color={GS.mist} wrap="truncate-end">{`  ${line}`}</Text>}
          </Box>,
        ))
        room -= lines.length
      }

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
      // Each running agent: its name, then what it is doing this moment (its own thinking, writing or tool call).
      const all = [...running.entries()]
      const fit = fitAgents(all.length, room, MAX_AGENT_ROWS)
      const shown = all.slice(all.length - fit.shown)
      const share = Math.max(1, Math.min(3, Math.floor(room / Math.max(1, shown.length))))
      shown.forEach(([id, a], i) => {
        const role = roleOf(a.name)
        const color = role === 'judge' ? GS.amber : role === 'builder' ? GS.clay : GS.mist
        const doing = `${doingOf(liveOf(id)) ?? a.label}${clockOf(liveOf(id), nowMs)}`
        const lines = rowsOf(` › ${doing}`, bandWidth - a.name.slice(0, 40).length - 4, share)
        lines.forEach((line, j) => rows.push(
          <Box key={`gs-ag${i}-${j}`} flexDirection="row">
            {j === 0
              ? <Box flexShrink={0}><Text color={GS.green}>{`${SPIN[(t + i) % SPIN.length]} `}</Text><Text color={color} bold>{a.name.slice(0, 40)}</Text></Box>
              : <Box flexShrink={0}><Text>{'    '}</Text></Box>}
            <Text wrap="truncate-end">{line}</Text>
            {j === 0 ? <Box flexShrink={0}><Text dimColor>{`  ${clock(nowMs - a.startMs)}`}</Text></Box> : null}
          </Box>,
        ))
        room -= lines.length
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
    const ledger = await read($, ledgerAtom)
    const routing = await read($, routingAtom)
    const projectUsd = await read($, projectUsdAtom)
    const keep = await read($, keepWarmAtom)
    const refresh = await read($, lastRefreshAtom)
    const paused = await read($, pausedAtom)
    const pevent = await read($, eventAtom)
    const actions = await read($, actionsAtom)
    const readiness = await read($, readinessAtom)
    const startup = await read($, startupAtom)
    const ttl = await ttlNow($)
    const cacheLeftMs = cacheLeft(nowMs, await read($, lastReplyAtAtom), ttl)
    const money = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(2)}`)

    // One round card per section from 44 columns, as ruflo's console draws its sections; narrower, plain stacks.
    const cols = e.props.bodyColumns ?? 40
    const cards = cols >= 44
    const inner = Math.max(10, cols - (cards ? 4 : 2))
    // Cards take ruflo's amber edge unless a state colours them (waiting, released, building).
    const section = (key: string, edge0: string, body: any) => cards
      ? <Box key={key} flexDirection="column" borderStyle="round" borderColor={edge0 === 'subtle' ? RUFLO.amber : edge0} paddingX={1}>{body}</Box>
      : <Box key={key} flexDirection="column" paddingX={1}>{body}</Box>
    // A card heading as ruflo draws it: amber block glyphs, the label in bold amber, and a rule of ═ to the right.
    const head = (label: string, right?: string) => (
      <Box key={`h-${label}`} flexDirection="row" gap={1}>
        <Box flexShrink={0}><Text color={RUFLO.amber} bold>▐█▌</Text></Box>
        <Box flexShrink={0}><Text color={RUFLO.amber} bold wrap="truncate-end">{label}</Text></Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}><Text color={RUFLO.amber} wrap="truncate-end">{'═'.repeat(200)}</Text></Box>
        {right ? <Box flexShrink={0}><Text color={RUFLO.grey}>{right}</Text></Box> : null}
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
      ? [head('PROGRESS'), <Text key="pn" color={legacyEngine ? 'warning' : undefined} dimColor={!legacyEngine} wrap="wrap">{legacyEngine ? 'This project still runs the old Ghostship engine (its state is in .ghostship/). Type /ghostship:ghostship adopt to move it to this plugin: the progress, board and approvals carry over.' : 'No Ghostship project in this folder yet. Type /ghostship new to start a project.'}</Text>]
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
          {s.key === 'spec' ? <Text color={st!.awaiting && s.state === 'c' ? 'warning' : 'subtle'}>{'  ⏸ STOP 1'}</Text> : null}
        </Box>
      )
    }) : []

    // The board, grouped by what the tasks have become: built, being built, planned, parked.
    // Each task carries its own mark: ✓ done, a spinner while it is being built, ○ planned, ⚠ parked.
    const group = (key: string, title: string, glyph: string, color: string, tasks: Task[], spin = false) => tasks.length ? [
      <Text key={`${key}-h`} bold color={color}>{`${glyph} ${title}  ${tasks.length}`}</Text>,
      ...capped(key, tasks.map((t, i) => (
        <Box key={`${key}-${t.id}`} flexDirection="row">
          <Box flexShrink={0}><Text color={spin ? GS.green : color} bold={spin}>{`${spin ? SPIN[(Math.floor(nowMs / SPIN_MS) + i) % SPIN.length] : glyph} `}</Text></Box>
          <Text wrap="truncate-end">{`${t.id}  `}<Text bold>{t.name || t.label}</Text>{t.name && t.label ? <Text color="subtle">{`  · covers ${t.label}`}</Text> : null}</Text>
        </Box>
      ))),
    ] : []
    const isBuilt = (t: Task) => t.status === 'done' || t.status === 'merged'
    const isBuilding = (t: Task) => t.status === 'building' || t.status === 'judging' || t.status === 'doing'
    const boardBody = [
      ...group('gb', 'Built', '✓', GS.green, board.filter(isBuilt)),
      ...group('ga', 'Building', SPIN[Math.floor(nowMs / SPIN_MS) % SPIN.length]!, GS.green, board.filter(isBuilding), true),
      ...group('gp', 'Planned', '○', GS.mist, board.filter(t => !isBuilt(t) && !isBuilding(t) && t.status !== 'parked')),
      ...group('gk', 'Parked', '⚠', GS.amber, board.filter(t => t.status === 'parked')),
    ]

    const tab = (await read($, paneTabAtom)) ?? 'overview'
    const TABS = [['overview', 'Overview'], ['plan', 'Plan'], ['agents', 'Agents'], ['cost', 'Cost'], ['files', 'Files']] as const
    const tabBar = (
      <Box key="tabs" flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1}>
          {TABS.map(([k, l]) => (
            <Button key={`tab-${k}`} label={` ${l} `} {...(tab === k ? { variant: 'primary' as const } : { plain: true, dimColor: true })} onPress={() => void update($, paneTabAtom, () => k)} />
          ))}
        </Box>
        {controls}
      </Box>
    )
    // The plan: every phase of the build, its tasks in order, and how many are running, done, to do or on hold.
    const frame = Math.floor(nowMs / SPIN_MS)
    const gates = await read($, gatesAtom)
    const latestVerdict = new Map((evidence ?? []).map(v => [v.task, v.verdict] as const))
    // Per task: the tokens, the time and the list-price cost of every agent whose name carries its id.
    const perTask = new Map<string, { tokens: number; usd: number; ms: number }>()
    for (const a of ledger) {
      const id = taskOf(a.name)
      if (!id) continue
      const cur = perTask.get(id) ?? { tokens: 0, usd: 0, ms: 0 }
      perTask.set(id, { tokens: cur.tokens + a.input + a.output, usd: cur.usd + a.usd, ms: cur.ms + ((a.endMs ?? nowMs) - a.startMs) })
    }
    const totals = { tokens: ledger.reduce((n, a) => n + a.input + a.output, 0), usd: ledger.reduce((n, a) => n + a.usd, 0), running: ledger.filter(a => a.running).length, failed: (evidence ?? []).filter(v => v.verdict === 'fail').length, agents: ledger.filter(a => a.id !== 'main').length }
    const planSection = section('s-plan', 'subtle', (() => {
      const count = (f: (t: Task) => boolean) => board.filter(f).length
      const phases = [...new Set(board.map(t => t.phase))]
      const queued = (t: Task) => !isBuilt(t) && !isBuilding(t) && t.status !== 'parked'
      return [
        head('PLAN', `${board.length} tasks · ${phases.length} phases`),
        <Text key="pl-tot" dimColor wrap="truncate-end">{`${totals.agents} agents · ${totals.running} running · ${totals.failed} failed · ${fmtK(totals.tokens)} tokens · $${totals.usd.toFixed(2)}`}</Text>,
        <Box key="pl-sum" flexWrap="wrap" gap={2}>
          <Text color={GS.green}>{`✓ ${count(isBuilt)} done`}</Text>
          <Text color={GS.clay}>{`◆ ${count(isBuilding)} running`}</Text>
          <Text color={GS.mist}>{`○ ${count(queued)} to do`}</Text>
          <Text color={GS.amber}>{`⚠ ${count(t => t.status === 'parked')} on hold`}</Text>
        </Box>,
        ...(board.length ? phases.flatMap(p => {
          const ts = board.filter(t => t.phase === p)
          const done = ts.filter(isBuilt).length
          return [
            <Box key={`ph-${p}`} justifyContent="space-between" marginTop={1}>
              <Text bold color={GS.clay}>{`Phase ${p}`}</Text>
              <Text color="subtle">{`${done}/${ts.length} done`}</Text>
            </Box>,
            <Text key={`pb-${p}`} color={GS.clay}>{progressBar(done, ts.length, inner)}</Text>,
            ...ts.flatMap(t => {
              const run = isBuilding(t)
              const ev = latestVerdict.get(t.id)
              const mark = run ? SPIN[frame % SPIN.length]! : isBuilt(t) ? '✓' : t.status === 'parked' ? '⚠' : '○'
              const color = isBuilt(t) ? GS.green : run ? GS.green : t.status === 'parked' ? GS.amber : GS.mist
              const word = isBuilt(t) ? 'done' : run ? (t.status === 'judging' ? 'judging' : 'building') : t.status === 'parked' ? 'on hold' : 'to do'
              return [
                <Box key={`pt-${t.id}`} flexDirection="row" justifyContent="space-between" gap={1}>
                  <Box flexShrink={1} minWidth={0}>
                    <Text color={color} bold={run}>{`${mark} `}</Text>
                    <Text wrap="truncate-end">{`${t.id}  `}<Text bold>{t.name || t.label}</Text>{t.name && t.label ? <Text color="subtle">{`  · covers ${t.label}`}</Text> : null}</Text>
                  </Box>
                  <Box flexShrink={0} flexDirection="row" gap={2}>
                    {perTask.has(t.id) ? <Text dimColor>{`${fmtK(perTask.get(t.id)!.tokens)} · ${clock(perTask.get(t.id)!.ms)} · $${perTask.get(t.id)!.usd.toFixed(2)}`}</Text> : null}
                    <Text color={color}>{word}</Text>
                  </Box>
                </Box>,
                // The acceptance check that proves the task, and the latest verdict the judge recorded for it.
                <Box key={`pc-${t.id}`} flexDirection="row" gap={1}>
                  <Text color="subtle" wrap="truncate-end">{`   check  ${gates[t.id] ?? 'none recorded'}`}</Text>
                  {ev ? <Text color={ev === 'pass' ? 'success' : ev === 'fail' ? 'error' : 'warning'} wrap="truncate-end">{ev === 'pass' ? '✓ verified' : ev === 'fail' ? '✗ failed' : '⚠ parked'}</Text> : null}
                </Box>,
              ]
            }),
          ]
        }) : [<Text key="pl-none" dimColor>No plan yet: the tasks appear here once the plan is written.</Text>]),
      ]
    })())

    return (
      <Box flexDirection="column" gap={cards ? 0 : 1}>
        {tabBar}
        {pevent && nowMs - pevent.at < 30_000 ? <Text key="ev-top" color={pevent.tone === 'bad' ? 'error' : pevent.tone === 'warn' ? 'warning' : 'success'} wrap="truncate-end">{`› ${pevent.text}`}</Text> : null}
        {tab === 'overview' && section('s-banner', edge, [
          cards && cols >= WORDMARK_WIDTH + 8
            ? wordmark(ui, 'brand')
            : <Text key="brand" bold color={GS.clay}>G H O S T S H I P</Text>,
          <Text key="ver" dimColor>{version ? `v${version}` : ' '}</Text>,
          <Box key="app" justifyContent="space-between">
            <Text bold>{name ?? 'This app'}</Text>
            {stageLabel ? <Text color={st?.awaiting ? 'warning' : 'claude'}>{st?.awaiting ? '⏸ YOUR MOVE' : `● ${stageLabel}`}</Text> : null}
          </Box>,
          about
            ? <Text key="about" color={GS.mist} wrap="wrap">{about}</Text>
            : <Text key="about" dimColor wrap="wrap">No description yet: add one to package.json, or open the README with a one-line pitch.</Text>,
        ])}
        {tab === 'overview' && section('s-progress', edge, progress)}
        {tab === 'overview' && section('s-control', paused ? 'warning' : 'subtle', [
          head('CONTROL', paused ? 'taken back' : 'running'),
          <Text key="c-txt" dimColor wrap="wrap">{paused ? 'Every agent action is refused until you give control back. Nothing is lost: the build carries on from its files.' : 'The agents act on their own between your stops. Take control back to stop every action at once.'}</Text>,
          <Box key="c-btn" flexDirection="row" justifyContent="flex-end">
            {paused
              ? <Button key="c-give" label=" Give control back " variant="primary" onPress={() => void setPaused($, false)} />
              : <Button key="c-take" label=" Take back control " variant="secondary" onPress={() => void setPaused($, true)} />}
          </Box>,
        ])}
        {tab === 'overview' && startup && startup.length ? section('s-startup', startup.every(c => c.ok) ? 'subtle' : 'warning', [
          head('START-UP', startup.every(c => c.ok) ? `READY ${startup.length} of ${startup.length}` : `${startup.filter(c => c.ok).length} of ${startup.length} checks`),
          ...startup.map(c => (
            <Box key={`su-${c.name}`} flexDirection="row" gap={1}>
              <Text color={c.ok ? GS.green : RUFLO.amber} bold>{c.ok ? '[ OK ]' : '[ .. ]'}</Text>
              <Text>{c.name}</Text>
              <Text dimColor wrap="truncate-end">{c.detail}</Text>
            </Box>
          )),
        ]) : null}
        {tab === 'overview' && inProject && st && st.stage === 'done' ? section('s-round', RUFLO.amber, [
          head('ALL TASKS DONE', 'released'),
          <Box key="rd-row" flexDirection="row" justifyContent="space-between" gap={1}>
            <Text>Brainstorm the next round, or stop here.</Text>
            <Button key="rd-go" label=" start a new round " variant="primary" onPress={() => void $.prompt.fill({ text: `/${SKILL_COMMAND} round` }).catch(() => undefined)} />
          </Box>,
        ]) : null}
        {tab === 'overview' && inProject && st ? section('s-next', 'subtle', [
          head('NEXT STEPS', `${voyageOf(st.stage).filter(v => v.state === 'd').length} of ${voyageOf(st.stage).length} done`),
          ...voyageOf(st.stage).map(v => {
            const about: Record<string, string> = { interview: 'what the project is for', prd: 'what it must do', spec: 'what done means (STOP 1)', plan: 'the phases and tasks', tasks: 'one file per task', build: 'each task built and judged', release: 'the gate green, then tagged' }
            return (
              <Box key={`nx-${v.key}`} flexDirection="row" justifyContent="space-between" gap={1}>
                <Box flexShrink={1} minWidth={0} flexDirection="row" gap={1}>
                  <Text color={v.state === 'd' ? GS.green : v.state === 'c' ? GS.clay : GS.mist} bold={v.state === 'c'}>{v.state === 'd' ? '✓' : v.state === 'c' ? '▶' : '○'}</Text>
                  <Text bold={v.state === 'c'} color={v.state === 'd' ? 'subtle' : undefined}>{v.label}</Text>
                  <Text dimColor wrap="truncate-end">{about[v.key] ?? ''}</Text>
                </Box>
                {v.state === 'c' ? <Button key={`nx-go-${v.key}`} label=" do this " variant="primary" onPress={() => void $.prompt.fill({ text: `/${SKILL_COMMAND} resume` }).catch(() => undefined)} /> : null}
              </Box>
            )
          }),
        ]) : null}
        {tab === 'overview' && readiness ? section('s-live', readiness.missing.length ? 'warning' : 'subtle', [
          head('LIVE TEST', readiness.missing.length ? 'not ready' : 'ready'),
          ...(readiness.missing.length
            ? readiness.missing.map((m, i) => <Text key={`lt${i}`} color="warning" wrap="wrap">{`✗ ${m}`}</Text>)
            : [<Text key="lt-ok" color="success">✓ provider, lab and spend cap are set</Text>]),
          <Text key="lt-cap" dimColor>{readiness.cap ? `spend cap $${readiness.cap}` : 'no spend cap set'}</Text>,
        ]) : null}
        {tab === 'overview' && actions && actions.length ? section('s-actions', 'subtle', [
          head('ACTIONS', `${actions.length} recent`),
          ...[...actions].reverse().slice(0, 8).map((a, i) => (
            <Box key={`ac-${a.id}`} flexDirection="row" justifyContent="space-between" gap={1}>
              <Box flexShrink={1} minWidth={0}>
                {a.status === 'run'
                  ? <Text color={GS.green}>{`${SPIN[(Math.floor(nowMs / SPIN_MS) + i) % SPIN.length]} `}</Text>
                  : a.status === 'ok' ? <Text color={GS.green}>✓ </Text> : <Text color="error">✗ </Text>}
                <Text wrap="truncate-end">{a.label}</Text>
              </Box>
              <Box flexShrink={0}><Text dimColor>{a.status === 'refused' ? 'refused' : `${span(nowMs - a.at)} ago`}</Text></Box>
            </Box>
          )),
        ]) : null}
        {tab === 'overview' && inProject ? section('s-voyage', 'subtle', [head('VOYAGE', st!.phase ? `PHASE ${st!.phase}` : undefined), ...voyageRows]) : null}
        {tab === 'agents' && ledger.length ? section('s-agents', 'claude', [
          head('AGENTS', `${ledger.filter(a => a.running).length} running · ${ledger.filter(a => a.id !== 'main').length} spawned`),
          // Running first, then by what each has cost: whether it runs, its name and model, tokens in and out, its price.
          ...capped('ag', [...ledger].sort((a, b) => Number(b.running) - Number(a.running) || b.usd - a.usd).map((a, i) => {
            const role = roleOf(a.name)
            const live = running.get(a.id)
            const mark = a.id === 'main'
              ? <Text color={working ? GS.green : GS.clay}>{working ? `${SPIN[Math.floor(nowMs / SPIN_MS) % SPIN.length]} ` : '◆ '}</Text>
              : a.running
                ? <Text color={GS.green}>{`${SPIN[(Math.floor(nowMs / SPIN_MS) + i) % SPIN.length]} `}</Text>
                : <Text color="success">✓ </Text>
            return (
              <Box key={`pa-${a.id}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Box flexShrink={1}>{mark}<Text bold wrap="truncate-end">{a.name.slice(0, 32)}</Text></Box>
                  <Box flexShrink={0}><Text bold color={a.usd > 0 ? 'claude' : 'subtle'}>{money(a.usd)}</Text></Box>
                </Box>
                {a.running && doingOf(liveOf(a.id)) ? (
                  <Text key={`pth-${a.id}`} color={GS.mist} wrap="wrap">{`   ${doingOf(liveOf(a.id))}${clockOf(liveOf(a.id), nowMs)}`}</Text>
                ) : null}
                <Box flexDirection="row" justifyContent="space-between">
                  <Text dimColor wrap="truncate-end">{`  ${a.id === 'main' ? (working ? `working${doingOf(liveOf('main')) ? ` › ${doingOf(liveOf('main'))}` : '…'}` : 'this session, idle') : a.running ? `running ${clock(nowMs - a.startMs)}${live ? ` › ${live.label}` : ''}` : `done in ${clock((a.endMs ?? nowMs) - a.startMs)}`}`}</Text>
                  <Box flexShrink={0}><Text dimColor>{`${modelLabel(a.model) ?? ''}  ${fmtK(a.input)} in · ${fmtK(a.output)} out`}</Text></Box>
                </Box>
              </Box>
            )
          })),
        ]) : null}
        {tab === 'agents' && section('s-route', 'subtle', [
          head('ROUTING', 'model per agent'),
          <Box key="r-main" justifyContent="space-between"><Text>Main thread</Text><Text dimColor>{`${modelLabel(lastModel) ?? 'the session model'} · decisions, spec, plan`}</Text></Box>,
          ...ROLES.map(role => (
            <Box key={`r-${role}`} justifyContent="space-between">
              <Text>{role === 'grunt' ? 'Search & reading' : role === 'builder' ? 'Builders' : 'Judges'}{role === 'judge' ? <Text dimColor> · retries on Opus</Text> : null}</Text>
              <Box flexDirection="row" gap={1}>
                {TIERS.map(tier => (
                  <Button key={`r-${role}-${tier}`} label={` ${tier[0]!.toUpperCase()}${tier.slice(1)} `} {...(routing[role] === tier ? { variant: 'primary' as const } : { plain: true, dimColor: true })} onPress={() => void setRouting($, role, tier)} />
                ))}
              </Box>
            </Box>
          )),
        ])}
        {tab === 'overview' && inProject && (active || st!.red || st!.green) ? section('s-flight', 'subtle', [
          head('IN FLIGHT', active ? `${active.id} · ${active.name || active.label}` : undefined),
          st!.builder ? <Text key="b" dimColor>{`builder ${st!.builder}`}</Text> : null,
          st!.judge ? <Text key="j" color="claude" bold>{`◆ judge `}<Text dimColor>{st!.judge}</Text></Text> : null,
          st!.red ? <Text key="r" color="error">{`red  ✗ `}<Text dimColor>{st!.red}</Text></Text> : null,
          st!.green ? <Text key="g" color="success">{`green ✓ `}<Text dimColor>{st!.green}</Text></Text> : null,
        ]) : null}
        {tab === 'plan' && planSection}
        {tab === 'overview' && evidence && evidence.length ? section('s-rec', 'subtle', [
          disclosure('RECORDER', recorderOpen, `${evidence.length} verdicts`, () => void update($, recorderOpenAtom, () => !recorderOpen)),
          recorderOpen ? (
            <Box key="ev" flexWrap="wrap">
              {evidence.slice(-6).map((v, i) => (
                <Text key={`ev${i}`} color={v.verdict === 'pass' ? 'success' : v.verdict === 'fail' ? 'error' : 'warning'}>{`${v.verdict === 'pass' ? '✓' : v.verdict === 'fail' ? '✗' : '⚠'} ${v.task}${board.find(t => t.id === v.task)?.name ? ` ${board.find(t => t.id === v.task)!.name}` : ''}  `}</Text>
              ))}
            </Box>
          ) : null,
        ]) : null}
        {tab === 'files' && section('s-files', 'subtle', [
          disclosure('FILES', filesOpen, `${files.length} at the top level`, () => void update($, filesOpenAtom, () => !filesOpen)),
          ...(filesOpen
            ? capped('f', files.length
              ? files.map((f, i) => f.isDir
                ? <Text key={`f${i}`} bold color={GS.mist}>{`  ${f.name}/`}</Text>
                : <Text key={`f${i}`} color={GS.subtle}>{`  ${f.name}`}</Text>)
              : [<Text key="f-none" dimColor>  no files</Text>])
            : []),
        ])}
        {tab === 'cost' && section('s-cache', cacheLeftMs !== null && cacheLeftMs <= 0 ? 'warning' : 'subtle', [
          head('CACHE', working ? 'warm · a turn is running'
            : cacheLeftMs === null ? 'no reply yet'
            : cacheLeftMs <= 0 ? 'expired' : `expires in ${countdown(cacheLeftMs)}`),
          <Text key="c-life" dimColor>{`each message resets it to ${ttl > 5 * 60_000 ? '1 hour' : '5 minutes'}${lastHit !== null ? ` · last reply ${lastHit}% from cache` : ''}`}</Text>,
          tokens ? (
            <Text key="c-cold" color={cacheLeftMs !== null && cacheLeftMs <= 0 ? 'warning' : 'subtle'}>
              {`${cacheLeftMs !== null && cacheLeftMs <= 0 ? 'next send writes' : 'once cold, the next send writes'} ${fmtK(tokens)} tokens again ≈ ${money(coldWriteUsd(lastModel, tokens, ttl))}`}
            </Text>
          ) : null,
          refresh ? (
            <Text key="c-last" color={refresh.warm ? 'success' : 'warning'}>
              {`${refresh.warm ? '✓' : '⚠'} last refresh ${span(nowMs - refresh.at)} ago: ${refresh.warm ? `read ${fmtK(refresh.read)}` : `was cold, wrote ${fmtK(refresh.write)}`} · ${money(refresh.usd)}`}
            </Text>
          ) : null,
          <Box key="c-keep" flexDirection="row" justifyContent="space-between" marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color="subtle">Keep warm while away</Text>
              {[0, 1, 2].map(hrs => (
                <Button key={`c-k${hrs}`} label={` ${hrs ? `${hrs}h` : 'Off'} `} {...((keep ? keep.hours : 0) === hrs ? { variant: 'primary' as const } : { plain: true, dimColor: true })} onPress={() => void setKeepWarm($, hrs)} />
              ))}
            </Box>
            <Button key="c-refresh" label=" ↻ refresh " plain dimColor onPress={() => void refreshCache($)} />
          </Box>,
          keep ? <Text key="c-kl" dimColor>{`♨ keeping warm ${span(keep.until - nowMs)} more · a small refresh ${countdown(keepWarmLead(ttl))} before each expiry`}</Text> : null,
        ])}
        {tab === 'cost' && section('s-spend', 'subtle', [
          head('SPEND', projectUsd != null ? `project ${money(projectUsd)}` : undefined),
          (() => {
            const sp = splitSpend(ledger, usd)
            return (
              <Box key="sp-o" flexDirection="column">
                <Box justifyContent="space-between"><Text color="subtle">this session</Text><Text bold>{money(sp.session)}</Text></Box>
                <Box justifyContent="space-between"><Text color="subtle">  main thread</Text><Text>{money(sp.main)}</Text></Box>
                <Box justifyContent="space-between"><Text color="subtle">  subagents</Text><Text>{money(sp.subagents)}</Text></Box>
                {sp.byModel.map(([m, v]) => (
                  <Box key={`sp-m-${m}`} justifyContent="space-between"><Text dimColor>{`  on ${modelLabel(m) ?? m}`}</Text><Text dimColor>{money(v)}</Text></Box>
                ))}
                <Text dimColor wrap="wrap">{sp.estimated ? 'Estimated at list price.' : 'Session total from Claude Code; the split follows the per-agent share.'}</Text>
              </Box>
            )
          })(),
          spend ? (
            <Box key="sp">
              <Text color="subtle">{`tokens `}</Text>
              <Text>{fmtTokens(spend.tokens)}</Text>
              <Text color="subtle">{`   context `}</Text>
              <Text color={spend.ctxPct >= 85 ? 'warning' : 'subtle'}>{`${spend.ctxPct}%`}</Text>
            </Box>
          ) : null,
          inProject ? <Text key="auto" color="subtle">{`autonomy ${st!.autonomy || 'autopilot'}`}</Text> : null,
        ])}
      </Box>
    )
  })
}
