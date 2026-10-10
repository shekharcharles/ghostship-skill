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
      folded: boolean          // the voyage pane is minimized to its header
      foldedApp: boolean       // the overview pane is minimized to its header
    }
  }
}
