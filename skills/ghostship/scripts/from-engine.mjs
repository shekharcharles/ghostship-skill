#!/usr/bin/env node
// Move a project from the Ghostship engine edition to this plugin: node from-engine.mjs [project dir]
// Writes docs/ghostship/ from .ghostship/state/state.json and takes the engine's hooks out of .claude/settings.json
// (a backup is kept beside it). Leaves .ghostship/ in place; nothing loads it once the hooks are gone.
import fs from 'node:fs'
import path from 'node:path'
import { convert, unhook } from './engine-convert.mjs'

const dir = path.resolve(process.argv[2] ?? '.')
const at = p => path.join(dir, p)
const statePath = at('.ghostship/state/state.json')
if (!fs.existsSync(statePath)) {
  console.error(`No engine edition here: ${statePath} is missing.`)
  process.exit(1)
}
if (fs.existsSync(at('docs/ghostship/STATE.md'))) {
  console.error('docs/ghostship/STATE.md already exists: this project was moved already. Nothing changed.')
  process.exit(1)
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const config = fs.existsSync(at('.ghostship/config.yaml')) ? fs.readFileSync(at('.ghostship/config.yaml'), 'utf8') : ''
const { files, report } = convert(state, config)
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(at(rel)), { recursive: true })
  fs.writeFileSync(at(rel), text)
}

const settingsPath = at('.claude/settings.json')
let unhooked = 'no engine hooks found in .claude/settings.json'
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  const next = unhook(settings)
  if (next) {
    fs.copyFileSync(settingsPath, at('.claude/settings.engine-backup.json'))
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n')
    unhooked = 'the engine hooks and status line are out of .claude/settings.json (backup: .claude/settings.engine-backup.json)'
  }
}
console.log(`Moved to docs/ghostship/: ${report}.\n${unhooked}.`)
