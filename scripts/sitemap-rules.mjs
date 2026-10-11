// The pure rules of the sitemap: which lines declare a route, which lines link to one. No imports, so tests load it directly.
const ROUTE_PATTERNS = [
  /\b(?:app|router|bp|blueprint|api|server|fastify)\.(?:get|post|put|delete|patch|all|route|use)\(\s*['"`]([^'"`]+)['"`]/,
  /@(?:app|bp|blueprint|router)\.(?:route|get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/,
  /\bpath\s*[:=]\s*['"`](\/[^'"`]*)['"`]/,
  /\b(?:Route|route)\s+(?:path|url)\s*=\s*['"](\/[^'"]*)['"]/,
]
const LINK_PATTERNS = [/\bhref\s*=\s*['"`](\/[^'"`#?]*)/, /\bto\s*=\s*['"`](\/[^'"`#?]*)/, /\bsrc\s*=\s*['"`](\/[^'"`#?]*)/, /navigate\(\s*['"`](\/[^'"`#?]*)/, /redirect\(\s*['"`](\/[^'"`#?]*)/]

/** Every match of every pattern on a line, once each: a line that matches two patterns still counts its route once. */
function allMatches(line, patterns) {
  const found = new Map()
  for (const p of patterns) {
    for (const m of line.matchAll(new RegExp(p.source, 'g'))) if (m[1]) found.set(`${m.index}:${m[1]}`, m[1])
  }
  return [...found.values()]
}

/** The routes and links one file declares, with the line number of each. */
export function scanFile(path, text) {
  const routes = []
  const links = []
  text.split('\n').forEach((line, i) => {
    for (const route of new Set(allMatches(line, ROUTE_PATTERNS))) routes.push({ route, file: path, line: i + 1 })
    for (const target of allMatches(line, LINK_PATTERNS)) links.push({ target, file: path, line: i + 1 })
  })
  return { routes, links }
}

const norm = p => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** Whether a link reaches a route: the same path, or a path that fits the route's parameters (`/orders/:id` takes `/orders/1`). */
export function reaches(route, target) {
  const r = norm(route)
  const t = norm(target)
  if (r === t) return true
  if (!r.includes(':')) return false
  const re = new RegExp(`^${r.split('/').map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`)
  return re.test(t)
}

/**
 * Routes nothing links to. The root and API routes are not expected to be linked from a page, so they are never reported.
 */
export function orphans(routes, links) {
  return routes.filter(r => {
    const p = norm(r.route)
    if (p === '/' || p.startsWith('/api') || p.includes('*')) return false
    return !links.some(l => reaches(r.route, l.target))
  })
}

/** The sitemap as Markdown: every route with where it is declared, and the routes nothing links to. */
export function sitemapMarkdown(routes, links) {
  const lines = ['# Sitemap', '', 'Generated from the code by scripts/sitemap.mjs. Every route and every link to it is here; orphans are the first suspects.', '', '| Route | Declared at | Linked from |', '|---|---|---|']
  for (const r of routes) {
    const from = links.filter(l => reaches(r.route, l.target)).map(l => `${l.file}:${l.line}`).slice(0, 3).join(', ') || '—'
    lines.push(`| \`${r.route}\` | ${r.file}:${r.line} | ${from} |`)
  }
  const o = orphans(routes, links)
  lines.push('', `## Orphans (${o.length})`, '', o.length ? o.map(r => `- \`${r.route}\` at ${r.file}:${r.line}: nothing links to it`).join('\n') : 'None.', '')
  return lines.join('\n')
}
