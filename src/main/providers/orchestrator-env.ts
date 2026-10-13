/**
 * The environment prefixes that belong to *another* orchestrator, and never to an Employee (T234).
 *
 * TinyCorp is not the only thing on this machine that drives a coding-agent CLI. Orca, Conductor
 * and their kind each install a hook in the product's **global** config — `~/.claude/settings.json`,
 * `~/.codex/hooks.json`, `~/.config/opencode/plugins/` — and every one of those hooks reads the
 * environment to decide which of *its own* panes an event belongs to. TinyCorp spawns its Employees
 * out of the app process, and the app was started from the boss's shell, so those variables are
 * inherited and the hook fires: the boss got an Orca notification when a TinyCorp Employee replied.
 *
 * So a Session is spawned without them. The same strip covers the other half of it, which is an
 * Employee *reading* them — `ORCA_AGENT_HOOK_TOKEN` is a bearer token for another app's local
 * server, and nothing in this Company has any business holding one.
 *
 * It is a denylist of prefixes rather than a list of names on purpose. A variable that turns up
 * later under a prefix already here is covered, and an orchestrator we have never heard of is one
 * line. The cost of being wrong is small in one direction and large in the other: a prefix listed
 * by mistake costs an Employee a variable nothing in a coding agent reads, while a prefix missed
 * costs the boss a notification storm from an app they are not even looking at.
 *
 * It is the one answer for every Provider. No product has a flag for this — Claude Code's
 * `--setting-sources` skips the boss's own `settings.json` but not the other two products' global
 * config, and OpenCode's `--pure` would take TinyCorp's own status plugin with it — so the strip
 * is what all three share, and `provider-conformance.ts` holds every adapter to it.
 */
export const ORCHESTRATOR_ENV_PREFIXES = [
  /** Orca, the multi-agent IDE: hook port, hook token, pane key, worktree id. */
  'ORCA_',
  /** Conductor, the macOS orchestrator. */
  'CONDUCTOR_',
  /** Crystal, the multi-session Claude Code manager. */
  'CRYSTAL_',
  /** Sculptor, Imbue's parallel-agent workspace. */
  'SCULPTOR_',
  /** Happy Coder, the mobile Claude Code client. */
  'HAPPY_',
  /** Omnara, the agent dashboard. */
  'OMNARA_',
  /** Terragon, the hosted agent runner. */
  'TERRAGON_',
] as const

/**
 * `env` with every other orchestrator's variables taken out (T234).
 *
 * Every adapter runs its inherited environment through this before it spawns anything, on top of
 * whatever its own product needs stripped. It removes and never rewrites: a Provider that wants a
 * variable kept says so in its own filter, and this one never adds.
 */
export function withoutOrchestratorEnv<T extends NodeJS.ProcessEnv>(env: T): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isOrchestratorVar(name)))
}

/** Whether `name` belongs to another orchestrator, and so to no Session this app starts. */
export function isOrchestratorVar(name: string): boolean {
  return ORCHESTRATOR_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
}
