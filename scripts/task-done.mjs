#!/usr/bin/env node
// Records a task's red or green run from its real exit code. The builder never writes this record itself.
// Usage: node task-done.mjs <red|green|verify> <TASK-ID> <folder> -- <command>
// verify is run by a verifier subagent only (the mod refuses it from the main thread); it alone writes the PASS line.
// Exit 0 when the run is recorded; 1 when it is refused (the reason is printed).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { countTests, verdictOf, failedAttempts, nextAttempt } from './gate-verdict.mjs'

function readLedgerLines(text) {
  return text.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
}

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
  const decisionsPath = path.join(root, 'docs/ghostship/DECISIONS.md')
  // The fix loop: after four failed attempts a task runs again only with a ruling in DECISIONS.md.
  const before = existsSync(ledgerPath) ? readLedgerLines(readFileSync(ledgerPath, 'utf8')) : []
  const hasRuling = existsSync(decisionsPath) && readFileSync(decisionsPath, 'utf8').includes(`Ruling: ${task}`)
  const loop = nextAttempt(failedAttempts(before, task), hasRuling)
  if (!loop.ok) {
    console.error(`${task} ${phase}: refused — ${loop.why}`)
    return 1
  }
  if (loop.fresh) console.log(`${task}: ${loop.note}`)
  const evidencePath = path.join(root, 'docs/ghostship/EVIDENCE.md')
  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  const run = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const exitCode = run.status ?? 1
  const tests = countTests(output)
  const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  const hasRed = ledger.some(r => r.task === task && r.phase === 'red' && r.recorded)
  const hasGreen = ledger.some(r => r.task === task && r.phase === 'green' && r.recorded)
  const verdict = verdictOf({ phase, exitCode, tests, hasRed, hasGreen })
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const entry = { task, phase, command, exitCode, tests, head, recorded: verdict.ok, at: new Date().toISOString() }
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`)
  if (!verdict.ok) {
    console.error(`${task} ${phase}: refused — ${verdict.why}`)
    return 1
  }
  if (phase === 'red') {
    console.log(`${task} red: recorded (exit ${exitCode}, the test fails as it should)`)
  } else if (phase === 'green') {
    console.log(`${task} green: recorded (${tests} tests). Not done until a verifier passes it.`)
  } else {
    appendFileSync(evidencePath, `- ${task} · PASS · red and green: recorded in LEDGER.jsonl · verified by a subagent: ${command} → pass (${tests} checks, exit 0)\n`)
    console.log(`${task} verify: passed (${tests} checks); EVIDENCE.md updated`)
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
