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
      boardOpen: boolean       // the voyage pane's BOARD section is expanded
      recorderOpen: boolean    // the voyage pane's RECORDER section is expanded
    }
  }
}
