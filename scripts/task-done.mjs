#!/usr/bin/env node
// Records a task's red or green run from its real exit code. The builder never writes this record itself.
// Usage: node task-done.mjs <red|green|verify> <TASK-ID> <folder> -- <command>
// verify is run by a verifier subagent only (the mod refuses it from the main thread); it alone writes the PASS line.
// Exit 0 when the run is recorded; 1 when it is refused (the reason is printed).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { cannotRun, countTests, verdictOf, failedAttempts, nextAttempt, nonTestChanges, tautologies } from './gate-verdict.mjs'

/** Every refusal is printed and written to FAILURES.jsonl with its code, so the retro can count repeats. */
function refuse(root, { code, task, phase, message }) {
  mkdirSync(path.join(root, 'docs/ghostship'), { recursive: true })
  appendFileSync(path.join(root, 'docs/ghostship/FAILURES.jsonl'), `${JSON.stringify({ code, task, phase, at: new Date().toISOString() })}\n`)
  console.error(message)
  return 1
}

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
    return refuse(root, { code: 'fix-loop', task, phase, message: `${task} ${phase}: refused — ${loop.why}` })
  }
  if (loop.fresh) console.log(`${task}: ${loop.note}`)
  // Red comes first: the repro is recorded before any source changes.
  const status = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' }).stdout ?? ''
  if (phase === 'red') {
    const early = nonTestChanges(status)
    if (early.length) {
      return refuse(root, { code: 'source-before-repro', task, phase, message: `${task} red: refused — source changed before its repro: ${early.join(', ')}. Write the failing test first.` })
    }
  }
  // A test must test something: a changed test whose expected value is the value under test is refused.
  if (phase === 'green') {
    const testFiles = status.split('\n').filter(Boolean).map(l => l.slice(3).trim()).filter(p => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/.test(p))
    for (const f of testFiles) {
      let text = ''
      try { text = readFileSync(path.join(root, f), 'utf8') } catch { continue }
      const hits = tautologies(text)
      if (hits.length) {
        return refuse(root, { code: 'tautology', task, phase, message: `${task} green: refused — tautological test in ${f} line ${hits[0].line}: ${hits[0].text}` })
      }
    }
  }
  const evidencePath = path.join(root, 'docs/ghostship/EVIDENCE.md')
  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  const run = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const cannot = cannotRun({ exitCode: run.status, error: run.error ? String(run.error.message ?? run.error) : null })
  if (cannot) {
    // Not verified: recorded, not counted as an attempt, and it blocks the release until a run goes through.
    const head0 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
    appendFileSync(ledgerPath, `${JSON.stringify({ task, phase, command, exitCode: run.status, tests: 0, head: head0, recorded: false, status: 'unverified', reason: cannot, at: new Date().toISOString() })}\n`)
    return refuse(root, { code: 'unverified', task, phase, message: `${task} ${phase}: not verified — ${cannot}` })
  }
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
    return refuse(root, { code: verdict.code, task, phase, message: `${task} ${phase}: refused — ${verdict.why}` })
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
