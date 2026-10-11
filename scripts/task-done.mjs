#!/usr/bin/env node
// Records a task's red or green run from its real exit code. The builder never writes this record itself.
// Usage: node task-done.mjs <red|green> <TASK-ID> <folder> -- <command>
// Exit 0 when the run is recorded; 1 when it is refused (the reason is printed).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { countTests, verdictOf } from './gate-verdict.mjs'

function main(argv) {
  const sep = argv.indexOf('--')
  const [phase, task, folder = '.'] = argv.slice(0, sep)
  const command = argv.slice(sep + 1).join(' ')
  if (sep < 0 || !phase || !task || !command) {
    console.error('usage: task-done.mjs <red|green> <TASK-ID> <folder> -- <command>')
    return 1
  }
  const root = path.resolve(folder)
  const ledgerPath = path.join(root, 'docs/ghostship/LEDGER.jsonl')
  const evidencePath = path.join(root, 'docs/ghostship/EVIDENCE.md')
  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  const run = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const exitCode = run.status ?? 1
  const tests = countTests(output)
  const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  const hasRed = ledger.some(r => r.task === task && r.phase === 'red' && r.recorded)
  const verdict = verdictOf({ phase, exitCode, tests, hasRed })
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const entry = { task, phase, command, exitCode, tests, head, recorded: verdict.ok, at: new Date().toISOString() }
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`)
  if (!verdict.ok) {
    console.error(`${task} ${phase}: refused — ${verdict.why}`)
    return 1
  }
  if (phase === 'red') {
    console.log(`${task} red: recorded (exit ${exitCode}, the test fails as it should)`)
  } else {
    appendFileSync(evidencePath, `- ${task} · PASS · red: recorded in LEDGER.jsonl · green: ${command} → pass (${tests} tests, exit 0)\n`)
    console.log(`${task} green: recorded (${tests} tests); EVIDENCE.md updated`)
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
