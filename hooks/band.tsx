// Ghostship's terminal band: a Client surface module. It animates locally — the current stage breathes
// and the active task's clock ticks — from the last snapshot the hooks published. It ALWAYS shows the full
// seven-stage voyage with the two STOPs marked, wrapping to a second line when the terminal is narrow.
import type { ClientModule, RenderElement } from 'claude-code'

import { GS, mix, clock } from './lib.ts'
import type { StageState } from './state.ts'

export type BandProps = {
  stages: { label: string; state: StageState }[]
  curLabel: string
  released: boolean
  phase: string | null
  task: string | null
  stop: string | null
  awaiting: boolean
  activeMs: number
}

type BandState = { t: number; base: number; at: number }

let latest: BandProps = { stages: [], curLabel: '', released: false, phase: null, task: null, stop: null, awaiting: false, activeMs: -1 }

const Band: ClientModule<BandProps, BandState> = (props, surface) => {
  if (surface.state === undefined) {
    surface.setState({ t: 0, base: props.activeMs, at: 0 })
    surface.every(90, () => {
      const s = surface.state
      if (!s) return
      const isNew = latest.activeMs !== s.base
      surface.setState({ t: s.t + 1, base: latest.activeMs, at: isNew ? s.t + 1 : s.at })
    })
  }
  latest = props
  const st = surface.state ?? { t: 0, base: props.activeMs, at: 0 }
  const { Box, Text } = surface.elements
  const t = st.t
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.13)
  const curColor = mix(GS.clay, GS.clayLit, pulse)
  const elapsed = props.activeMs >= 0 ? props.activeMs + Math.max(0, t - st.at) * 90 : -1
  const width = Math.max(24, surface.columns || 80)

  // Which stop (if any) is waiting now: STOP 1 at the Spec stage, STOP 2 at Release.
  const stop1Hot = props.awaiting && props.curLabel === 'Spec'
  const stop2Hot = props.awaiting && (props.curLabel === 'Release' || props.released)
  const stopMark = (hot: boolean) => <Text color={hot ? mix(GS.amber, '#fff2d9', pulse * 0.5) : GS.subtle} bold={hot}>{' ⏸'}</Text>

  const items: RenderElement[] = [<Text key="b" color={GS.clay} bold>⛴ Ghostship</Text>, <Text key="bs" color={GS.subtle}>{'  '}</Text>]
  props.stages.forEach((s, i) => {
    const glyph = s.state === 'd' ? '✓' : s.state === 'c' ? '◆' : '○'
    items.push(
      s.state === 'c'
        ? <Text key={`v${i}`} color={curColor} bold>{glyph} {s.label}</Text>
        : s.state === 'd'
          ? <Text key={`v${i}`} color={GS.green} dimColor>{glyph} {s.label}</Text>
          : <Text key={`v${i}`} color={GS.subtle}>{glyph} {s.label}</Text>,
    )
    if (s.label === 'Spec') items.push(<Text key="st1">{stopMark(stop1Hot)}</Text>)
    if (s.label === 'Release') items.push(<Text key="st2">{stopMark(stop2Hot)}</Text>)
    if (i < props.stages.length - 1) items.push(<Text key={`sp${i}`} color={GS.subtle}>{'  ›  '}</Text>)
  })
  if (props.task && !props.awaiting) {
    items.push(<Text key="tk" color={GS.subtle}>{'     '}</Text>)
    items.push(<Text key="tkv" dimColor>{props.task}</Text>)
    if (elapsed >= 0) items.push(<Text key="el" dimColor>{` · ${clock(elapsed)}`}</Text>)
  }

  // A fixed-width row with wrap lets the voyage flow onto a second line on a narrow terminal
  // instead of collapsing or truncating — every stage stays visible.
  return (
    <Box width={width} flexWrap="wrap" flexDirection="row">
      {items}
    </Box>
  )
}

export default Band
