#!/usr/bin/env node
// Writes docs/ghostship/SITEMAP.md from the code: every route, every link, and the orphans. Usage: node sitemap.mjs <project folder>
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { scanFile, sitemapMarkdown } from './sitemap-rules.mjs'

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', 'target', 'vendor'])
const EXT = /\.(m?[jt]sx?|py|html?|vue|svelte|rb|go|php)$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

export function buildSitemap(root) {
  const routes = []
  const links = []
  for (const file of walk(root)) {
    const rel = path.relative(root, file)
    const r = scanFile(rel, readFileSync(file, 'utf8'))
    routes.push(...r.routes)
    links.push(...r.links)
  }
  return { routes, links, markdown: sitemapMarkdown(routes, links) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] ?? '.')
  const { routes, links, markdown } = buildSitemap(root)
  mkdirSync(path.join(root, 'docs/ghostship'), { recursive: true })
  writeFileSync(path.join(root, 'docs/ghostship/SITEMAP.md'), markdown)
  console.log(`sitemap: ${routes.length} routes, ${links.length} links → docs/ghostship/SITEMAP.md`)
}
