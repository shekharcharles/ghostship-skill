# Ghostship (skill edition)

An autonomous software factory as a **Claude Code plugin** — not an app you `node install.mjs`. One orchestrator **skill** carries a project from idea to a released, test-backed build; **mods** (hooks) are added to enforce the process and show live progress.

## Why a plugin, not a bare skill

A plugin is a superset: it holds the instructional **skill** (the workflow), the **mods** (hooks — live feedback and enforcement), and any helper scripts — and it installs like a skill (`/plugin`), with no separate install step. Pure instructional skills drift off-process because nothing enforces them; the mods are the lever that adds reliability back without a Node engine.

## The voyage

intake → PRD → design → **STOP 1** (acceptance checks) → phased plan → TDD build (builder + judge subagents) → **STOP 2** (release).

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

**`◆ Ghostship ▾`**, at the right of the prompt's footer, opens the **control panel** above the prompt: the build mode (`tdd` / `verify` / `iterative`) and autonomy (`autopilot` / `auto`), written straight to `STATE.md`; the band on or off; the pane open or minimized; and launch buttons that put `/ghostship:ghostship new`, `resume`, `status` or `release` in the prompt for you to send.

The pane opens when you ask: `/ghostship`, or **Open** in the control panel. Its `–` minimizes it to the `◆ Ghostship` button; the panel opens it again.

The band's second line is your usage: context fill, the prompt-cache countdown, and how much of the 5-hour and weekly limits is used. **↻ cache** at its end keeps the cache warm (one tiny request over the cached conversation), and a toast warns a minute before it goes cold. The countdown runs from the last reply; set the cache lifetime (`5m` or `1h`) in the plugin's settings.

## Unattended between the stops

Between STOP 1 and STOP 2 nothing waits on you. The skill parks anything that needs you (a check that cannot pass honestly, a task out of retries) and writes it to `docs/ghostship/DECISIONS.md` with a recommended answer; STOP 2 asks them all at once. The mod enforces it: `AskUserQuestion` is refused during plan, tasks and build, and a turn that tries to end while tasks remain is sent back to the next one (three times at most without progress on the board, so it can never loop forever).

The pane reads the project's own files (`package.json` or `README.md`, `docs/ghostship/STATE.md`, `BOARD.md`, `EVIDENCE.md`, the top-level folder), so it shows something useful in any project.

## Layout

- `.claude-plugin/` — plugin and marketplace manifests
- `skills/ghostship/SKILL.md` — the orchestrator skill
- `hooks/register.tsx` — the one hooks module: the pane, the band, commands, update check
- `hooks/state.ts`, `hooks/overview.ts`, `hooks/agents.ts` — pure helpers (parsing, grouping, step labels), no engine needed
- `hooks/band.tsx`, `hooks/lib.ts` — the band's voyage line and the palette
- `types/index.d.ts` — the `$.state` contract
- `tests/` — `claude plugin test` suites

Status: **0.5.0**, in active development. The earlier engine edition lives at github.com/shekharcharles/ghostship.
