// Ghostship's band: the whole voyage above the prompt, drawn by the hooks module itself. It always shows the
// seven stages with the two STOPs marked, wrapping to a second line when the terminal is narrow. The hooks module
// redraws it each second (ui.invalidate), so the pulse and the elapsed clock stay live.

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
  version: string
}

/** The band as a tree: `ui` is the terminal's element table, `t` a frame counter that drives the pulse. */
export function bandTree(ui: { Box: any; Text: any }, props: BandProps, width: number, t: number, elapsed: number): any {
  const { Box, Text } = ui
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.13)
  const curColor = mix(GS.clay, GS.clayLit, pulse)

  // Which stop (if any) is waiting now: STOP 1 at the Spec stage, STOP 2 at Release.
  const stop1Hot = props.awaiting && props.curLabel === 'Spec'
  const stop2Hot = props.awaiting && (props.curLabel === 'Release' || props.released)
  const stopMark = (hot: boolean) => <Text color={hot ? mix(GS.amber, '#fff2d9', pulse * 0.5) : GS.subtle} bold={hot}>{' ⏸'}</Text>

  const items: any[] = [<Text key="b" color={GS.clay} bold>⛴ Ghostship</Text>]
  if (props.version) items.push(<Text key="ver" color={GS.subtle}>{` v${props.version}`}</Text>)
  items.push(<Text key="bs" color={GS.subtle}>{'  '}</Text>)
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
