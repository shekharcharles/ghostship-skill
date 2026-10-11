# Ghostship

An autonomous software factory as a **Claude Code plugin** — not an app you `node install.mjs`. One orchestrator **skill** carries a project from idea to a released, test-backed build; **mods** (hooks) are added to enforce the process and show live progress.

## Why a plugin, not a bare skill

A plugin is a superset: it holds the instructional **skill** (the workflow), the **mods** (hooks — live feedback and enforcement), and any helper scripts — and it installs like a skill (`/plugin`), with no separate install step. Pure instructional skills drift off-process because nothing enforces them; the mods are the lever that adds reliability back without a Node engine.

## The voyage

intake → PRD → design → **STOP 1** (acceptance checks) → phased plan → TDD build (builder + judge subagents) → release (automatic when the gate is green).

State is plain markdown under `docs/ghostship/`, so any fresh session resumes by reading it. See `skills/ghostship/SKILL.md`.

## Install (once published)

```
/plugin marketplace add shekharcharles/ghostship-skill
/plugin install ghostship --marketplace shekharcharles/ghostship-skill
```

Then in any project: `/ghostship new` (or `adopt`, `resume`).

## Views

| You type | What you see |
|---|---|
| `/ghostship` | The **Ghostship pane**: the app and its one-line pitch, progress, the voyage, live agents, the task in flight, the board, verdicts, files, spend |
| `/ghostship-band` | Show or hide the band above the prompt |
| `/ghostship-update` | Check for and install the latest version |

**`◆ Ghostship ▾`**, at the right of the prompt's footer, opens the **control panel** above the prompt: the build mode (`tdd` / `verify` / `iterative`) and autonomy (`autopilot` / `auto`), written straight to `STATE.md`; the band on or off; the pane open or minimized; the **Cache** lifetime (5m / 1h); a **Check for update** button (when a newer version is found it shows the version and an **Update** button); and launch buttons that put `/ghostship:ghostship new`, `resume`, `status` or `release` in the prompt for you to send.

The pane opens when you ask: `/ghostship`, or **Open** in the control panel. Its `–` minimizes it to the `◆ Ghostship` button; the panel opens it again.

The band's second line is your usage: the model, **what this project has cost across all its sessions** (and this session), a context bar with the tokens used out of the window, the 5-hour use and when it resets, the weekly use, the prompt-cache countdown (⏳, with what the next send costs once it is cold) and hit rate. **↻ cache** keeps the cache warm (one tiny request over the cached conversation) and says whether it was still warm; a toast warns a minute before it goes cold.

The pane adds three cards:

- **AGENTS** — the main thread and every subagent of this session: running (with its current step) or done, its model, tokens in and out, and what it has cost.
- **CACHE** — warm or cold and for how long, the lifetime in use, what a cold send would write again and cost, the last refresh's receipt, and **Keep warm while away** (Off / 1h / 2h): while on, one small refresh goes out shortly before the cache would go cold (10 minutes ahead on a one-hour cache), and it stops by itself if a refresh finds the cache already gone.
- **ROUTING** — which model each subagent role runs on (Haiku / Sonnet / Opus per role).
- **SPEND** — the project, this session, the main thread against the subagents, and the split by model.

**Smart routing.** The main thread (the orchestrator: interview, spec, plan, the STOP decisions) stays on the session's model, Opus, whose cache lasts the session. Each subagent is put on its role's model as it starts: searches and reading (`Explore`) on **Haiku**, **builders** and **judges** on **Sonnet**. A judge of a task that already failed once (an earlier judge of it this session, or a FAIL for it in `EVIDENCE.md`) runs on **Opus**: the retry is the hard case. The pane's **ROUTING** card changes any role's model, kept across sessions. Routing per subagent, not per step, matters: each model keeps its own cache, so switching the main thread to a cheaper model mid-conversation makes that model write the whole conversation again, which costs more than it saves.

Prices are list prices (after [cache-tax](https://github.com/karanb192/cache-tax), MIT); the session total is Claude Code's own when it reports one. The cache lifetime defaults to 1h (a Claude subscription); set `5m` in the **◆ Ghostship menu → Cache** on an API key. Your choice wins; otherwise the engine's own figure, reported on a model switch, is used. A resumed session that comes back cold says what its first message will cost.

## Unattended after the one stop

After STOP 1 (approve the spec) nothing waits on you — there is no stop at release. The skill parks anything that needs you (a check that cannot pass honestly, a task out of retries) and writes it to `docs/ghostship/DECISIONS.md` with a recommended answer, applies that answer, and lists it in the release report. The mod enforces it: `AskUserQuestion` is refused after STOP 1 (through plan, tasks, build and release), and a turn that tries to end while tasks remain is sent back to the next one (three times at most without progress on the board, so it can never loop forever). When the release gate is green, the release is tagged automatically — no approval prompt.

The pane reads the project's own files (`package.json` or `README.md`, `docs/ghostship/STATE.md`, `BOARD.md`, `EVIDENCE.md`, the top-level folder), so it shows something useful in any project.

## Moving a project from the engine edition

A project the earlier engine edition ran (a `.ghostship/` folder, the `gs` commands, the Bridge pane) moves over with `/ghostship:ghostship adopt`. The skill stops the old runner and runs `skills/ghostship/scripts/from-engine.mjs`, which writes `docs/ghostship/` from `.ghostship/state/state.json`: the stage, the board (merged tasks done, retired ones parked, and the tasks waiting on them parked with a decision applied and reported), the evidence, and links to the approved PRD and acceptance checks, which stay approved. It takes the engine's hooks and status line out of `.claude/settings.json` (a backup is kept beside it) and leaves `.ghostship/` in place. Until then the band and the pane say the project still runs the old engine.

## Live test and spend cap

Before STOP 1 the skill asks for three things: the AI provider and the name of its key variable (never the key), a lab to test against (a deliberately vulnerable application, with two or three candidates found by search and a recommendation), and a spend cap in dollars. They are written to `STATE.md` as `provider env:`, `lab url:` and `spend cap:`. Every 30 seconds the pane checks them: the key variable is set, the lab answers, and a cap is set. The **LIVE TEST** card lists what is missing. When the session reaches the cap, control is taken back and the pane says so.

## What the pane shows now

- **START-UP:** the checks that Ghostship is ready, each `[ OK ]` or `[ .. ]`: project state, board, live test, usage reading, update check. It reads "READY 5 of 5" when all pass.
- **NEXT STEPS:** the stages of the project, ✓ done, ▶ current with a **do this** button that puts `/ghostship:ghostship resume` in the prompt, ○ to do.
- **Plan tab:** each task shows its tokens, time and cost, and a line of totals: agents, running, failed, tokens and cost.
- **The phase line** shows how long the model has been in its phase and roughly how many tokens it has streamed, for example "Thinking: … · 12s · 1.2k tokens".
- **Turn done:** a toast says how long the turn took and what the session has cost.

## New rounds

When every task is done and the release is tagged, the pane's **ALL TASKS DONE** card offers **start a new round**, and `/ghostship:ghostship resume` asks whether to start one or stop. A round opens with brainstorming: you bring your ideas, the agent discusses them with you and writes them up with what each would change, and you decide each one: keep, later or drop. Only the kept ideas go on to a PRD, a spec you approve (STOP 1), phases in `plan.md`, tasks on the board with new numbers, and the build.

## What "built" means

A task is built only when the running application does what the spec says, from its real entry point, against the lab with the real provider. The Plan tab marks a finished task **built** only when its evidence line carries an `e2e:` run; otherwise it is **unproven**. Unit tests alone never make a task built, and "zero findings" from a detector is a failure against a lab with known findings.

## Test first, and talking while it builds

Each task is built red, then green: the builder records a failing test and its failure, then the passing run, and the judge runs the product end to end. The Plan tab marks a task **built** only when all three are on its evidence line, and **no red test** when the failing run is missing. The **discuss a change** button on the Plan tab puts a message in the prompt. You can talk while builders run: the discussion changes no files until you say apply, and then the PRD, the board and the criteria are updated, with dropped tasks and their dependants parked.

## Enforced: no done without proof

The mod refuses any write to `docs/ghostship/BOARD.md` that marks a task `done` or `merged` unless its latest PASS line in `EVIDENCE.md` has a red run before the green one, and an end-to-end run. The refusal goes back to the agent with the reason, and the top line says which tasks lack proof. The check covers Edit, Write and MultiEdit.

## Control

**Take back control** (Overview, or the ◆ Ghostship menu → Control) stops every agent action at once: the main thread and each subagent are refused, the build is not nudged to carry on, and the pane's top line says so. **Give control back** puts `/ghostship:ghostship resume` in the prompt for you to send. Refusals show on the top line too: a delete that could remove more than it names, a question during the unattended build, and any action while control is taken back. The **ACTIONS** card lists the last twelve actions with ✓ done, ✗ refused, or a spinner while running.

## The pane's tabs

The pane is tabbed, so you pick a view instead of scrolling one long list: **Overview** (progress, voyage, what is in flight, the recorder), **Plan** (every phase of the build, its tasks in order, each with its status: done, running, to do or on hold, and the counts per phase), **Agents** (each agent, its task, its model and cost, and the ROUTING card), **Cost** (the cache and the spend), and **Files**. The spinner turns about ten times a second while work runs.

## Layout

- `.claude-plugin/` — plugin and marketplace manifests
- `skills/ghostship/SKILL.md` — the orchestrator skill
- `hooks/register.tsx` — the one hooks module: the pane, the band, commands, update check
- `hooks/state.ts`, `hooks/overview.ts`, `hooks/agents.ts`, `hooks/usage.ts`, `hooks/routing.ts` — pure helpers (parsing, grouping, step labels), no engine needed
- `hooks/band.tsx`, `hooks/lib.ts` — the band's voyage line and the palette
- `types/index.d.ts` — the `$.state` contract
- `tests/` — `claude plugin test` suites

Status: **0.25.0**, in active development. The earlier engine edition lives at github.com/shekharcharles/ghostship.

## Credits

The band's "what is the agent doing" line (the phase model, the thought's latest sentence, and the tool-call labels in `hooks/activity.ts`) is copied from [tzafrir/whats-agent-doing](https://github.com/tzafrir/whats-agent-doing), MIT, Copyright (c) 2026 Tzafrir Rehan.
