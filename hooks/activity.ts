// Copied from tzafrir/whats-agent-doing (MIT, Copyright (c) 2026 Tzafrir Rehan; see its LICENSE): the text and tool-label helpers
// that its box uses for the model's thinking and each tool call. Pure, so tests run it without an engine.

/** Collapses runs of whitespace, newlines included, to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cuts `text` to `max` characters, marking the cut with an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The sentence Claude is thinking right now: the tail of the thought so far,
 * with the sentence before it when the current one has barely started.
 *
 * @param thought the thinking block's text so far
 * @param max the longest snippet, cut from the front
 */
export function thoughtOf(thought: string, max: number): string {
  const flat = oneLine(thought.replace(/[*_`#>]/g, ''))

  if (flat === '') {
    return ''
  }

  const sentences = flat.split(/(?<=[.!?:])\s+/)
  const last = sentences.at(-1) ?? ''
  const before = sentences.at(-2)
  const tail = last.length < 25 && before !== undefined ? `${before} ${last}` : last

  return tail.length > max ? `…${tail.slice(-(max - 1))}` : tail
}

export function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}


const MAX_DETAIL_CHARS = 60

/**
 * Says in a few words what a tool call is doing, for What's Agent Doing.
 *
 * @param tool the tool's name; a string, as the declared names are only the
 *   tools of the build that wrote the types (Grep and Glob are on some only)
 * @param args the call's arguments, whole or as far as they have streamed
 * @returns a short label such as `Reading register.tsx`
 */
export function activityOf(tool: string, args: Record<string, unknown>): string {
  const arg = (key: string): string => {
    const value = args[key]

    return typeof value === 'string' ? clip(oneLine(value), MAX_DETAIL_CHARS) : ''
  }

  const file = (key: string): string => baseName(arg(key))

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return arg('description') || `Running ${arg('command')}`
    case 'Read':
      return `Reading ${file('file_path')}`
    case 'Edit':
      return `Editing ${file('file_path')}`
    case 'Write':
      return `Writing ${file('file_path')}`
    case 'NotebookEdit':
      return `Editing ${file('notebook_path')}`
    case 'Grep':
      return `Searching for "${arg('pattern')}"`
    case 'Glob':
      return `Finding files ${arg('pattern')}`
    case 'WebFetch':
      return `Fetching ${hostOf(arg('url'))}`
    case 'WebSearch':
      return `Searching the web for "${arg('query')}"`
    case 'Agent':
    case 'Task':
      return `Running an agent: ${arg('description')}`
    case 'TodoWrite':
      return 'Updating the todo list'
    case 'AskUserQuestion':
      return 'Waiting for your answer'
    case 'Skill':
      return `Using the ${arg('skill')} skill`
  }

  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')

    return `Using ${server}: ${name}`
  }

  return `Using ${tool}`
}

/**
 * The string arguments a tool call's input has streamed so far, read from
 * its partial JSON: enough to name the file or command before it is whole.
 */
export function partialArgsOf(json: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}

  for (const match of json.matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)/g)) {
    const [, key = '', raw = ''] = match

    args[key] ??= unescaped(raw)
  }

  return args
}

function unescaped(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Counts the words a streamed chunk adds, carrying whether the text so far
 * ends inside a word, so a reply is never counted again from its start.
 *
 * @param chunk the newly streamed text
 * @param isInWord whether the text before it ended inside a word
 */
export function wordsAdded(chunk: string, isInWord: boolean): { added: number; isInWord: boolean } {
  const words = chunk.match(/\S+/g)?.length ?? 0
  const continues = isInWord && /^\S/.test(chunk)
  return {
    added: continues ? words - 1 : words,
    isInWord: chunk === '' ? isInWord : /\S$/.test(chunk),
  }
}
