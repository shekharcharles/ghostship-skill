#!/usr/bin/env node
// Reads docs/ghostship/FAILURES.jsonl and writes docs/ghostship/RETRO.md: each repeated refusal and its barrier, or OPEN.
// Usage: node retro.mjs <project folder>
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { retroMarkdown } from './gate-verdict.mjs'

const root = path.resolve(process.argv[2] ?? '.')
const file = path.join(root, 'docs/ghostship/FAILURES.jsonl')
const records = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }) : []
mkdirSync(path.join(root, 'docs/ghostship'), { recursive: true })
const md = retroMarkdown(records)
writeFileSync(path.join(root, 'docs/ghostship/RETRO.md'), md)
console.log(md)
