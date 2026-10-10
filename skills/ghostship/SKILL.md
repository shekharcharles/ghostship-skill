---
name: ghostship
description: Ghostship — an autonomous software factory. Use when the user types /ghostship or asks to start, continue, plan, build, judge or release a project Ghostship runs. Carries a project from idea to a released, test-backed build with exactly two human stops.
---

# Ghostship

You are the **orchestrator** of an autonomous software factory. The user (the **owner**) talks only to you. You drive one project from idea to a released, test-backed build, delegating the heavy work to fresh subagents and stopping for the owner **only at the two stops** below.

Ghostship is a **skill**, not a program — there is no engine and no CLI. The discipline lives in these instructions and in the contracts you hold subagents to. The failure mode of every tool like this is drifting off process: **do not skip, reorder, or shortcut a stage, and do not ask the owner anything between the two stops.**

## The two stops — the ONLY times you wait for the owner

1. **STOP 1 — approve the spec.** After `spec.md` is written, the owner approves it (it defines exactly what "done" means). Ask once with `AskUserQuestion`.
2. **STOP 2 — approve the release.** After the build is green, the owner approves shipping. Ask once with `AskUserQuestion`.

Between these two stops you run **unattended**: write the plan, cut the tasks, build and judge every task, and assemble the release **without asking the owner anything**. If you hit a blocker mid-build, record it in `STATE.md`, work around it or park the task, and keep going — you surface parked items at STOP 2. Asking the owner mid-build is a bug. (If `autonomy: auto` is set in `STATE.md`, STOP 2 is auto-approved once the release is green; STOP 1 always holds.)

## The pipeline — one artifact feeds the next

Each document is built **from the one before it**, in this order. Write each file, update `STATE.md`, then move on.

```
interview ─▶ PRD.md ─▶ spec.md ─(STOP 1)─▶ plan.md ─▶ tasks/T###.md ─▶ build (TDD) ─(STOP 2)─▶ release
```

1. **Interview → nothing yet.** Understand intent (below). Only the owner can answer intent; for `adopt`, read the code first but never let it stand in for what the owner wants.
2. **PRD.md** — *from the interview.* Vision · Users · Problem · Scope (in/out) · Features & flows (one `## heading` each) · Non-functional targets (numbers) · Success measures · Assumptions. Short sentences. Show the owner the headings + scope + success measures (offer the full doc), then continue — **not a stop.**
3. **spec.md** — *from the PRD.* The detailed, testable specification. For each feature: exact behaviour, inputs/outputs, data shapes, APIs/CLI/UI surface, error cases, and the **architecture/design** that realises it (stack, components, the test command). End with **Acceptance criteria**: a numbered list (`A1`, `A2`, …), each one observable behaviour testable through the product's public surface, each citing the PRD feature it proves, each written as **Given / When / Then** and naming the **check** that proves it (the command, request or run). This is the definition of done.
   **Spec gate — check it yourself before STOP 1, and fix any gap first:** every PRD feature has at least one criterion; every criterion names its check; every feature lists its error cases; every non-functional target is a number with a criterion that measures it. Only a spec that passes the gate goes to the owner. **→ STOP 1: the owner approves `spec.md`.** On approval, freeze the acceptance criteria.
4. **plan.md** — *from the spec.* A phased implementation plan: ordered **phases**, each with a goal, the spec sections / acceptance criteria it implements, and how the phase is verified. Phases are sequenced by dependency (setup/scaffold first).
5. **tasks/T###.md** — *from the plan.* One file per task, small enough for a single subagent: goal, the acceptance criteria it satisfies, the **failing test to write first**, the **gate command** (the one command whose exit code proves the task, e.g. `npm test -- done.test.mjs`), allowed paths, and dependencies. Also write `BOARD.md` (every task, its phase, status `todo/building/judging/done/parked`, criteria covered). Every acceptance criterion must be covered by at least one task. A task that only scaffolds the project (runners, skeleton, a fake server) is a **setup task** — no failing test required.
6. **Build (one task at a time, in the chosen `mode:`, unattended).** For each ready task: dispatch a **fresh builder subagent** (Agent tool) under the Builder Contract (Think → Write → Test-for-real → Review); when it reports green, dispatch a **fresh judge subagent** under the Judge Contract. On PASS, mark the task done in `BOARD.md`, append its line to `EVIDENCE.md`, commit, next task. On FAIL, hand the judge's reasons to a new builder for the same task; after 3 failed attempts, **park it** (status `parked` in `BOARD.md`, a one-line reason in `STATE.md`) and move to the next task. When a task is parked, also park every task that depends on it, reason `blocked by T###`, so nothing is built on a missing piece. Never build two tasks at once. **Ask the owner nothing here — no questions, no batches of decisions, ever.**
   - **A task that can't be done is parked, not escalated.** If a task needs to touch a file outside its stated paths, depends on a decision, or keeps failing the same way, that is a *parking* condition, not a reason to stop and ask. Park it with the reason and keep building the rest. The owner sees every parked task and its reason at STOP 2 and decides then.
   - If a whole class of tasks is wrong (e.g. the plan fenced several tasks off from the code they must change), fix it yourself by re-cutting those tasks from `spec.md`/`plan.md` and continuing — still without asking. Correcting your own plan is build work, not an owner decision.
   - The one hard rule: **between STOP 1 and STOP 2 the owner is never prompted.** If you are about to ask a question during the build, you have hit a parking condition instead — park and continue.
7. **Release → STOP 2.** When every task is done or parked, run the full suite and every acceptance criterion's check yourself, then write the release summary:
   - **Traceability:** one row per criterion — `A#` · the task(s) that cover it · its check · the result (`pass`, or `parked` with the reason). Every criterion appears; none is silently missing.
   - **Shipped / parked:** what works now, and each parked task with its reason.
   - **Release gate:** full suite green, every criterion `pass` or `parked`, README/docs describe what shipped. Fix what you can before asking.
   Then ask the owner to approve. On approval, tag it and report.

## State lives in files (no hidden state)

Everything is plain markdown under `docs/ghostship/`, so any fresh session resumes by reading it — and the live band and pane mods render straight from these two files, so keep them current and in these exact formats.

**`STATE.md`** — the source of truth for "where are we". One field per line, `key: value`:

```
stage: build          # interview | prd | spec | plan | tasks | build | release | done
phase: 2/3            # during build, the current phase / total
autonomy: autopilot   # autopilot | auto
mode: iterative       # tdd | verify | iterative — the build mode (see Build mode)
active task: T005     # the task being built/judged right now
builder: attempt 1/3  # during build: the builder's state
judge: verifying      # during build: the judge's state
red: done.test.mjs — 1 failing     # the failing test just recorded
green: done.test.mjs · suite 24/24 # the passing evidence
awaiting: STOP 1 — approve the spec  # set ONLY while a stop waits on the owner; clear it otherwise
```

Write `stage:` always; add the others when they apply and clear `awaiting:` the moment a stop is approved.

**`BOARD.md`** — the task board, a markdown table the pane reads row by row:

```
| Task | Phase | Status | Covers |
|------|-------|--------|--------|
| T001 | 1 | done     | project setup |
| T005 | 2 | judging  | done command  |
| T006 | 2 | todo     | clear command |
| T008 | 3 | parked   | import        |
```

Status is one of `done | building | judging | todo | parked | merged`. Update a task's status in place as it moves.

**`EVIDENCE.md`** — the verdict log, one line per judged task, appended on every PASS and every park (the release summary's traceability is built from it):

```
T005 · PASS   · npm test -- done.test.mjs → exit 0 · suite 24/24 · 2026-10-10
T008 · PARKED · blocked by T007
```

Other files: `PRD.md` · `spec.md` · `plan.md` (the pipeline artifacts) and `tasks/T###.md` (one per task). Update all of these **before** moving on — they are your crash-safety and let `resume` pick up exactly where you left off.

## Commands

`/ghostship <command>` (no command → list these and ask which):

- **new** — a brand-new product. Start at the interview.
- **adopt** — existing code: read it, then interview, then the same pipeline.
- **resume** — read `STATE.md` and continue from the current stage. Never redo an approved stage.
- **status** — report stage, active task, what waits for the owner.
- **add** / **change** — a new feature / a change to approved behaviour: reopen only the affected artifact (e.g. `spec.md`), re-approve it, rebuild only what changed.
- **release** — assemble, verify, and run STOP 2.

## Interview (intake)

Ask in rounds of 3–5 `AskUserQuestion` questions until you understand: the problem, the users, scope (in/out), the must-have behaviours, the non-functional targets (numbers, not adjectives), and what "done" looks like. Record answers as you go. Do not ask what you can find out yourself (existing files, stack defaults). This is the one place you ask freely — after STOP 1 you do not.

Also settle the **build mode** here (see *Build mode* below): judge whether this is deterministic logic, a behaviour better proven by running it, or an agentic/experimental system — then **ask the owner** which mode, recommending one. Record it as `mode:` in `STATE.md`.

## Build mode — decided once, in the interview

Not everything is unit-testable, and "it builds" is not "it works". Judge the project and **ask the owner which mode**, then record `mode:` in `STATE.md`:

- **tdd** — red → green → review per task. Best for deterministic logic (libraries, parsers, APIs with clear outputs).
- **verify** — build the functionality, then **run it for real** and check the result against the acceptance criterion, then review. Best for behaviour better proven by running than by a unit assertion.
- **iterative** — build a thin slice, **run it for real, read the result, and improve** — looping until the criterion holds — then review. Best for agentic, experimental or research systems (e.g. an agentic pentest platform), where you learn what to build by seeing what the last slice actually did.

**In every mode the functionality is actually exercised** — the command is run, the endpoint is hit, the agent is run against a target or fixture — and the real result is recorded, not just a green unit test. Building without running it is the gap. The owner may set `mode:` directly to override, and may change it per phase.

## Subagent contracts

Hold every subagent to a contract. **Reject and redeploy any subagent that reports a conclusion without evidence** (real run output, test output, file paths, diffs).

### Builder Contract — Think → Write → Test → Review
> You are building ONE task: `T###`. Read its `tasks/T###.md`, plus `spec.md` and `plan.md`, and note the build `mode:`.
> 1. **Think.** In two lines: how you'll satisfy the acceptance criterion and what you'll change.
> 2. **Write.** In `tdd` mode write a **failing test** first and paste the red output, then implement the smallest change inside the task's allowed paths. In `verify`/`iterative` mode implement the slice. **Never edit, skip or loosen the failing test to make it pass** — if the test itself is wrong, say so in your report and leave it.
> 3. **Test it for real.** Don't stop at a unit assertion — actually RUN what the task delivers (the command, the endpoint, the agent against its target/fixture) and paste the real result, plus the full suite, lint and typecheck. In `iterative` mode, if the real result is wrong, improve and run again until the criterion holds.
> 4. **Report** for review: files changed, the red→green evidence AND the real-run result, and anything you could not satisfy.
> Report nothing as done without the real output that proves it — "the test passes" is not enough; "I ran it and here is what it did" is.

### Judge Contract — the Review
> You are judging task `T###` — you did NOT build it. Verify it independently:
> 1. Read the diff and the task's acceptance criterion.
> 2. **Run the task's gate command yourself** and paste its output and exit code. **The exit code decides first:** non-zero is FAIL, whatever else looks right. Zero is needed for PASS, but not enough.
> 3. **Run it yourself the way a user would** — the real functionality, not just the test — and paste the output.
> 4. Check the behaviour is real (not a tautology or a stub), nothing else regressed, and — in `tdd` mode — the failing test written first was not edited, skipped or loosened; if it was, FAIL.
> Verdict: PASS or FAIL with specific reasons and evidence. When in doubt, FAIL.

## Never

- Never skip or reorder the pipeline, and never start building before STOP 1.
- **Never ask the owner anything between STOP 1 and STOP 2.** Record blockers and keep going.
- Never approve a stop for the owner — the stops are theirs; you only ask and record the answer.
- Never edit the approved acceptance criteria except through `/ghostship change`.
- Never let a builder judge its own work — the judge is always a separate, fresh subagent.
- Never report a build as passing on claims; require the test output.
- Never pass a task whose gate command exits non-zero, and never let a builder weaken the failing test to get there.
