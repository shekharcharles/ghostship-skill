// Which model each subagent runs on, by its role. The main thread keeps the session's model (Opus), because its cache is the one
// that lasts the session; each subagent starts a conversation of its own, so its model costs no cache it would lose.
// Pure, so tests run it without an engine.

export type Role = 'grunt' | 'builder' | 'judge'
export type Tier = 'haiku' | 'sonnet' | 'opus'
export type Routing = Record<Role, Tier>

export const ROLES: Role[] = ['grunt', 'builder', 'judge']
export const TIERS: Tier[] = ['haiku', 'sonnet', 'opus']
export const DEFAULT_ROUTING: Routing = { grunt: 'haiku', builder: 'sonnet', judge: 'sonnet' }

// The full model ids, so a rewrite names exactly what runs; a family alias would follow the engine's default instead.
const MODEL_ID: Record<Tier, string> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }

/** The role an agent plays: Explore reads and searches (grunt); a judge checks a gate; anything else builds. */
export function roleOf(subagentType: string, name: string | undefined, description: string): Role {
  if (/explore/i.test(subagentType)) return 'grunt'
  if (/judge/i.test(`${subagentType} ${name ?? ''} ${description}`)) return 'judge'
  return 'builder'
}

/** The model id a role runs on under the routing. */
export function modelFor(routing: Routing, role: Role): string {
  return MODEL_ID[routing[role]]
}

/** The routing as the user set it; anything unknown falls back to the default for its role. */
export function cleanRouting(v: unknown): Routing {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const pick = (r: Role): Tier => ((TIERS as string[]).includes(o[r] as string) ? (o[r] as Tier) : DEFAULT_ROUTING[r])
  return { grunt: pick('grunt'), builder: pick('builder'), judge: pick('judge') }
}
