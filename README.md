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

## Layout

- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — makes the repo its own marketplace
- `skills/ghostship/SKILL.md` — the orchestrator skill
- `hooks/` — mods (added next): live stage band, process guards

Status: **0.1.0**, in active development. The earlier engine edition lives at github.com/shekharcharles/ghostship.
