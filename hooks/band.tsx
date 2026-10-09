// Ghostship's terminal band: a Client surface module. It animates locally — the current stage breathes
// and the active task's clock ticks — from the last snapshot the hooks published, so the hooks publish only
// on change. Below ~118 columns it collapses to the essentials; it never wraps (truncate-end).
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
      const isNew = latest.activeMs !== s.base // a fresh figure restarts the local count
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
  const compact = (surface.columns || 80) < 118

  const line: RenderElement[] = [<Text key="b" color={GS.clay} bold>⛴ Ghostship</Text>]

  if (props.awaiting && props.stop) {
    line.push(<Text key="s" color={GS.subtle}>{'  ·  '}</Text>)
    line.push(<Text key="st" color={mix(GS.amber, '#fff2d9', pulse * 0.5)} bold>{`⏸ ${props.stop}`}</Text>)
  } else if (compact) {
    line.push(<Text key="s" color={GS.subtle}>{'  ·  '}</Text>)
    line.push(<Text key="c" color={props.released ? GS.green : curColor} bold>{props.released ? '✓ Released' : `◆ ${props.curLabel}`}</Text>)
    if (props.phase) line.push(<Text key="ph" color={GS.subtle}>{`  ${props.phase}`}</Text>)
    if (props.task) {
      line.push(<Text key="tk" dimColor>{`  · ${props.task}`}</Text>)
      if (elapsed >= 0) line.push(<Text key="el" dimColor>{` ${clock(elapsed)}`}</Text>)
    }
  } else {
    line.push(<Text key="s" color={GS.subtle}>{'   '}</Text>)
    props.stages.forEach((s, i) => {
      const glyph = s.state === 'd' ? '✓' : s.state === 'c' ? '◆' : '○'
      line.push(
        s.state === 'c'
          ? <Text key={`v${i}`} color={curColor} bold>{glyph} {s.label}</Text>
          : s.state === 'd'
            ? <Text key={`v${i}`} color={GS.green} dimColor>{glyph} {s.label}</Text>
            : <Text key={`v${i}`} color={GS.subtle}>{glyph} {s.label}</Text>,
      )
      if (i < props.stages.length - 1) line.push(<Text key={`sep${i}`} color={GS.subtle}>{'  ›  '}</Text>)
    })
    if (props.task) {
      line.push(<Text key="tk" dimColor>{`     ${props.task}`}</Text>)
      if (elapsed >= 0) line.push(<Text key="el" dimColor>{` · ${clock(elapsed)}`}</Text>)
    }
  }

  return (
    <Box flexDirection="row">
      <Text wrap="truncate-end">{line}</Text>
    </Box>
  )
}

export default Band
