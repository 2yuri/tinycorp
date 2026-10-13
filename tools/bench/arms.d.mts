/** Types for `tools/bench/arms.mjs`, the arms of `pnpm bench:tokens` (T190, T197). */

export const RTK_AGENT: string
export const RTK_HOOK_NAME: string
/** The name the stand-in chat server of a `duo` cell is registered under: the app's own. */
export const DM_SERVER: string

/** What every arm is appended, identically, on top of its own text. */
export const SHARED_RULES: string

/** One arm: text it prepends, whether it hooks RTK, and the hooks it is entitled to. */
export interface Arm {
  id: string
  /** One line for the report's arm table. */
  what: string
  /** Its own system-prompt text, read lazily. Null when this arm adds none. */
  text: () => string | null
  rtk: boolean
  /** The shapes of run this arm means anything in: `solo`, `long`, `duo`, `boss`. */
  modes: readonly string[]
  /** The arm this one is that arm's text plus an addition, or null. */
  builtOn: string | null
  /** The MCP servers this arm is entitled to. Empty for every arm but a `duo` one. */
  mcp: readonly string[]
  /** Which colleague voice this arm is, for the wake prompts a `duo` cell writes. */
  voice: 'terse' | 'plain' | null
  /** The hook names this arm's transcript may show. Anything else is contamination. */
  declares: readonly string[]
}

/** One handler in a Claude Code settings file. */
export interface HookHandler {
  type: string
  command: string
}

/** The settings file an arm's run is started with. */
export interface ArmSettings {
  hooks: { PreToolUse: { matcher: string; hooks: HookHandler[] }[] }
}

export const ARMS: readonly Arm[]

export function armText(one: Arm): string | null
export function armOf(id: string): Arm | null
export function armIds(): string[]
export function armsOfMode(mode: string): Arm[]
export function armSystemPrompt(one: Arm): string
export function armSettings(one: Arm, machine: { rtkPath: string | null }): ArmSettings | null
export function rtkHookCommand(path: string, platform?: NodeJS.Platform): string
