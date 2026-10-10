// The app overview: what the project is, what it has built, and what it holds on disk.
// Pure helpers only, so the pane can call them while drawing and tests can run them without an engine.

import type { Task } from './state.ts'

export type AppEntry = { name: string; isDir: boolean }

export type Features = { built: string[]; active: string[]; planned: string[] }

// The app's name and one-line description: its package.json when it has one, else its README title.
export function appIdentity(pkgJson: string | null, readme: string | null): { name: string | null; about: string | null } {
  let name: string | null = null
  let about: string | null = null
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson)
      name = typeof pkg.name === 'string' ? pkg.name : null
      about = typeof pkg.description === 'string' ? pkg.description : null
    } catch {
      // Not valid JSON: fall through to the README.
    }
  }
  if (!name && readme) {
    const title = readme.match(/^#\s+(.+)$/m)
    name = title ? title[1].trim() : null
  }
  return { name, about }
}

// Board tasks grouped by what they cover: what is built, what is being built, what is planned.
export function featuresOf(tasks: Task[]): Features {
  const labels = (list: Task[]) => [...new Set(list.map(t => t.label).filter(Boolean))]
  return {
    built: labels(tasks.filter(t => t.status === 'done')),
    active: labels(tasks.filter(t => t.status === 'doing' || t.status === 'judging')),
    planned: labels(tasks.filter(t => t.status === 'todo')),
  }
}

// The project's own folders and files, folders first. Dotfiles and node_modules stay out of the overview.
export function appEntries(list: { name: string; kind: string }[]): AppEntry[] {
  return list
    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => ({ name: e.name, isDir: e.kind === 'dir' }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
}
