// Ghostship's band: the voyage above the prompt, drawn by the hooks module itself, on one line. Segments carry a
// priority; when the terminal is too narrow the lowest-priority ones are dropped, and the stages shrink to
// "current stage n/7" before anything else goes. The hooks module redraws it each second (ui.invalidate), so the
// pulse and the elapsed clock stay live.

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
  branch: string
}

const GAP = 3

/** The band as one line: `ui` is the terminal's element table, `t` a frame counter for the pulse, `elapsed` the active task's ms. */
export function bandTree(ui: { Box: any; Text: any }, props: BandProps, width: number, t: number, elapsed: number): any {
  const { Box, Text } = ui
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.13)
  const curColor = mix(GS.clay, GS.clayLit, pulse)

  // Which stop (if any) is waiting now: only STOP 1, at the Spec stage (release is automatic).
  const stop1Hot = props.awaiting && props.curLabel === 'Spec'
  const stop2Hot = props.awaiting && (props.curLabel === 'Release' || props.released)
  const stopMark = (hot: boolean) => <Text color={hot ? mix(GS.amber, '#fff2d9', pulse * 0.5) : GS.subtle} bold={hot}>{' ⏸'}</Text>

  const done = props.stages.filter(s => s.state === 'd').length
  const total = props.stages.length

  // Full track: every stage with its glyph, STOP 1 marked in place.
  const full: any[] = []
  let fullLen = 0
  props.stages.forEach((s, i) => {
    const glyph = s.state === 'd' ? '✓' : s.state === 'c' ? '◆' : '○'
    const text = `${glyph} ${s.label}`
    fullLen += text.length
    full.push(
      s.state === 'c'
        ? <Text key={`v${i}`} color={curColor} bold>{text}</Text>
        : s.state === 'd'
          ? <Text key={`v${i}`} color={GS.green} dimColor>{text}</Text>
          : <Text key={`v${i}`} color={GS.subtle}>{text}</Text>,
    )
    if (s.label === 'Spec') { full.push(<Text key="st1">{stopMark(stop1Hot)}</Text>); fullLen += 2 }
    if (s.label === 'Release') { full.push(<Text key="st2">{stopMark(stop2Hot)}</Text>); fullLen += 2 }
    if (i < total - 1) { full.push(<Text key={`sp${i}`} color={GS.subtle}>{' › '}</Text>); fullLen += 3 }
  })

  const brand = `Ghostship${props.version ? ` v${props.version}` : ''}`
  const compact = `${props.curLabel || 'no stage'} ${done}/${total}${props.awaiting ? ' ⏸' : ''}`
  const track = fullLen + GAP + brand.length <= width
    ? <Box key="track" flexDirection="row">{full}</Box>
    : <Text key="track" color={props.awaiting ? GS.amber : curColor} bold>{compact}</Text>
  const trackLen = fullLen + GAP + brand.length <= width ? fullLen : compact.length

  // Lower priority drops first. The brand and the track always stay.
  type Seg = { prio: number; len: number; el: any }
  const segs: Seg[] = [
    { prio: 0, len: brand.length, el: <Text key="brand" color={GS.clay} bold>{brand}</Text> },
    { prio: 0, len: trackLen, el: track },
  ]
  if (props.task && !props.awaiting) {
    const tk = `${props.task}${elapsed >= 0 ? ` · ${clock(elapsed)}` : ''}`
    segs.push({ prio: 2, len: tk.length, el: <Text key="tk" dimColor>{tk}</Text> })
  }
  if (props.branch) {
    const br = `⎇ ${props.branch}`
    segs.push({ prio: 3, len: br.length, el: <Text key="br" color={GS.subtle}>{br}</Text> })
  }

  const kept: Seg[] = []
  let used = 0
  for (const s of [...segs].sort((a, b) => a.prio - b.prio)) {
    const need = used + (kept.length ? GAP : 0) + s.len
    if (s.prio === 0 || need <= width) { kept.push(s); used = need }
  }
  // Keep the order the segments were written in.
  const ordered = segs.filter(s => kept.includes(s))

  return (
    <Box width={width} flexDirection="row" gap={GAP}>
      {ordered.map(s => s.el)}
    </Box>
  )
}
