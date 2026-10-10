# Ghostship (skill edition)

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

Status: **0.9.3**, in active development. The earlier engine edition lives at github.com/shekharcharles/ghostship.

## Credits

The band's "what is the agent doing" line (the phase model, the thought's latest sentence, and the tool-call labels in `hooks/activity.ts`) is copied from [tzafrir/whats-agent-doing](https://github.com/tzafrir/whats-agent-doing), MIT, Copyright (c) 2026 Tzafrir Rehan.
