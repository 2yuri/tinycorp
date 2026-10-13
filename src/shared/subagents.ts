/**
 * The subagents a running Session started inside its own process (T162): Claude Code's `Agent`
 * tool, for one. They have no terminal and no seat of their own; the app only listens to what the
 * Provider's hooks say about them, and nothing here starts one.
 *
 * `started` the parent asked for it and it has not reported in yet; `running` it is working;
 * `done` it stopped, or handed its answer back.
 */
export const SUBAGENT_STATES = ['started', 'running', 'done'] as const
export type SubagentState = (typeof SUBAGENT_STATES)[number]

/** One subagent, as the drawer's strip and its telemetry card read it. Never the transcript. */
export interface SubagentInfo {
  /** Stable for the life of the parent Session. */
  id: string
  /** The task's name, a few words: the chip. */
  name: string
  /** The first line of what it was asked to do, cut short: the card's title. */
  task: string
  state: SubagentState
  startedAt: string
  /** When it stopped; null while it has not. */
  endedAt: string | null
  /** What it is running now, e.g. `pnpm vitest run charts`; null before its first tool. */
  now: string | null
  /** How many files its edits touched. */
  filesChanged: number
}

/** The longest name and task kept: the strip needs the task's name, not the prompt. */
export const SUBAGENT_NAME_MAX = 40
export const SUBAGENT_TASK_MAX = 120
export const SUBAGENT_NOW_MAX = 80

/** `text` on one line and at most `max` characters, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}
