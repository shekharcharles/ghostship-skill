// Self-contained $.state contract for the Ghostship mod (no imports allowed here).

export type VoyageSnap = {
  stages: { label: string; state: 'd' | 'c' | 't' }[]
  curLabel: string
  released: boolean
  phase: string | null
  task: string | null
  stop: string | null       // the stop's text while awaiting
  awaiting: boolean
  activeMs: number          // elapsed on the active task when published; -1 for none
  visible: boolean
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus'

export type AgentSpend = {
  id: string; name: string; model: string | null; running: boolean; startMs: number; endMs: number | null
  input: number; output: number; steps: number; usd: number
}

declare module 'claude-code' {
  interface PluginState {
    ghostship: {
      snap: VoyageSnap | null
      hidden: boolean
      update: { latest: string } | null
      spend: { tokens: number; usd: number; ctxPct: number } | null
      evidence: { task: string; verdict: 'pass' | 'fail' | 'parked'; at: number }[]
      filesOpen: boolean       // the pane's FILES section is expanded
      panelOpen: boolean       // the control panel above the prompt is open (◆ Ghostship in the footer)
      lastReplyAt: number      // when the main model last answered ($.clock.now() ms; 0 before any): the cache countdown's start
      keepWarm: { until: number; hours: number } | null  // the keep-warm window ($.clock.now() ms) and the length picked
      lastRefresh: { at: number; warm: boolean; read: number; write: number; usd: number | null } | null  // the last ↻ cache or keep-warm refresh
      routing: { grunt: ModelTier; builder: ModelTier; judge: ModelTier }  // the model each subagent role runs on
      ledger: AgentSpend[]                              // this session's spend by agent: the main thread and each subagent
      projectUsd: number | null                          // every session of this project together (from $.store)
      cacheTtl: '5m' | '1h' | null       // the cache lifetime the engine last reported (a model switch carries it)
      cacheChoice: '5m' | '1h' | null     // the cache lifetime the owner picked in the ◆ Ghostship menu (overrides the above)
      gates: Record<string, string>          // each task's acceptance check (its gate command), keyed by task id
      paused: boolean                        // the owner took control back: every agent action is refused until they give it back
      paneEvent: { text: string; tone: 'bad' | 'warn' | 'ok'; at: number } | null  // the latest event, the pane's top line
      actions: { id: string; label: string; status: 'run' | 'ok' | 'refused'; at: number }[]  // recent actions, newest last
      paneTab: 'overview' | 'plan' | 'agents' | 'cost' | 'files'  // the pane's open tab
      boardOpen: boolean      // the voyage pane's BOARD section is expanded
      recorderOpen: boolean    // the voyage pane's RECORDER section is expanded
    }
  }
}
