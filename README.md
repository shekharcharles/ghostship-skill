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
| `/ghostship` | The **voyage** pane: stage, progress, board, in-flight task, evidence, spend |
| `/ghostship-overview` | The **app overview** pane: what the app is, what is built, what is being built, what is planned, and its files |
| `/ghostship-band` | Show or hide the stage band above the prompt |
| `/ghostship-update` | Check for and install the latest version |

The overview reads the project's own files (`package.json` or `README.md`, `docs/ghostship/BOARD.md`, the top-level folder), so it works in any project that has them.

## Layout

- `.claude-plugin/` — plugin and marketplace manifests
- `skills/ghostship/SKILL.md` — the orchestrator skill
- `hooks/register.tsx` — the one hooks module: panes, band, commands, update check
- `hooks/state.ts`, `hooks/overview.ts` — pure helpers (parsing, grouping), no engine needed
- `hooks/band.tsx`, `hooks/lib.ts` — the band's animated client and the palette
- `types/index.d.ts` — the `$.state` contract
- `tests/` — `claude plugin test` suites

Status: **0.2.0**, in active development. The earlier engine edition lives at github.com/shekharcharles/ghostship.
