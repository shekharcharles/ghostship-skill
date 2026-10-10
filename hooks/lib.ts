// Ghostship's own small drawing kit — written for this plugin, nothing copied.
// Pure helpers: colour maths, a terminal progress bar, and SVG primitives for the desktop surface.

export const GS = {
  clay: '#d97757',   // Ghostship accent (Claude's clay)
  clayLit: '#f0a988',
  green: '#6cc082',
  greenLit: '#c7f0d2',
  amber: '#e2ab61',
  ink: '#1f1e1d',
  mist: '#9ca3af',
  subtle: '#6b675f',
} as const

export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
/** Blend two hex colours, t in 0..1. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const k = clamp01(t)
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k)
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
/** A terminal progress bar to the nearest eighth: `█████▍░░░`. */
export function bar(ratio: number, width: number, empty = '░'): string {
  const w = Math.max(1, Math.floor(width))
  const exact = clamp01(ratio) * w
  const full = Math.floor(exact)
  const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ''
  const used = full + (part ? 1 : 0)
  return '█'.repeat(full) + part + empty.repeat(Math.max(0, w - used))
}

/** Clock from milliseconds: `2:04` or `1:02:04`. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// --- SVG, for the desktop surface ---

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif"
const MONO = "ui-monospace,'Cascadia Code','SF Mono',Consolas,monospace"
const XML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const xml = (s: string): string => s.replace(/[&<>"']/g, c => XML_ESC[c]!)

/** Theme-aware classes shared by every Ghostship drawing: t text, s secondary, m muted, k track, p panel. */
export const BASE_CSS = `
.t{fill:#1f1f1f}.s{fill:#5f5f5c}.m{fill:#8e8e8a}.k{fill:#e7e5e0}.p{fill:#f5f4f1}
@media (prefers-color-scheme: dark){.t{fill:#ededed}.s{fill:#b4b4b0}.m{fill:#7c7c78}.k{fill:#2d2d2b}.p{fill:#232322}}
.gpulse{animation:gp 1.6s ease-in-out infinite}@keyframes gp{50%{opacity:.5}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
`

export function svg(width: number, height: number, body: string, css = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${BASE_CSS}${css}</style>${body}</svg>`
}

/** Rough px width of UI text, for fitting labels. */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%MW]/.test(ch) ? 0.72 : 0.56) * size
  return w
}
export function fitText(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}
export function svgText(
  x: number, y: number, s: string,
  opts: { cls?: string; size?: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string } = {},
): string {
  const { cls = 't', size = 12, weight = 400, anchor = 'start', fill } = opts
  return `<text ${fill ? `fill="${fill}"` : `class="${cls}"`} x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-variant-numeric="tabular-nums">${xml(s)}</text>`
}
/** Pixel width a desktop band/pane gives a drawing for `columns` reported columns. */
export function pxOf(columns: number | undefined, fallback = 80, slack = 8): number {
  return Math.max(260, Math.min(1600, (columns || fallback) * 8 - slack))
}

/** Short token count: 1.2k, 3.4M. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n | 0)
}

/** The console palette of ruflo's console: amber headings and card edges, pink title accents, cyan, yellow for running, grey for hints. */
export const RUFLO = {
  amber: '#ffaf00',
  pink: '#ff005f',
  pinkLit: '#ff87d7',
  cyan: '#87d7d7',
  yellow: '#ffff87',
  grey: '#949494',
} as const
