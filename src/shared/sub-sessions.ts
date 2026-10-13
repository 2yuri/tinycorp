/**
 * The Sessions an Employee starts of its own (T163): each one a full Session on the boss's
 * subscription, with its own process, terminal and seat under the concurrency cap, working one
 * piece of the parent's ticket. One level only — a sub-session is started without the tool that
 * starts sessions.
 *
 * Unlike a subagent (T162), which runs inside the parent's process and has no terminal, a
 * sub-session is a second process the boss can watch and type into.
 */

/**
 * Where a sub-session works, as the Employee chose it; the app carries it out and never picks one.
 *
 * `own` a new worktree and branch off the parent's branch: parallel writes cannot collide, and the
 * parent merges the branch back. `shared` the parent's own worktree: nothing to merge, and writes
 * can collide, which is the parent's to manage.
 */
export const SUB_SESSION_WORKSPACES = ['own', 'shared'] as const
export type SubSessionWorkspace = (typeof SUB_SESSION_WORKSPACES)[number]

/**
 * `waiting` no seat is free under the cap yet; `starting` spawned, not yet handed its task;
 * `working` on its task; `done` its turn on the task ended; `stopped` stopped before that — by the
 * parent, by the app when the parent stopped or the ticket closed, or because its process exited.
 */
export const SUB_SESSION_STATES = ['waiting', 'starting', 'working', 'done', 'stopped'] as const
export type SubSessionState = (typeof SUB_SESSION_STATES)[number]

/** One sub-session, as the drawer's strip, its telemetry card and the parent's tools read it. */
export interface SubSessionInfo {
  /** Stable for the life of the app, and the id its terminal is attached by. */
  id: string
  /** The Employee that started it. */
  parentId: string
  /** The piece's name, a few words: the chip. */
  name: string
  /** The first line of the task it was given, cut short: the card's title. */
  task: string
  workspace: SubSessionWorkspace
  state: SubSessionState
  ticketId: number
  repoName: string
  /** Where it works: its own worktree, or the parent's. */
  path: string
  /** Its own branch for `own`; the parent's branch for `shared`. */
  branch: string
  /** The parent's branch, which an `own` branch starts from and is merged back into. */
  parentBranch: string
  /** When it was asked for. */
  startedAt: string
  endedAt: string | null
  /** The tool it is running now, e.g. `pnpm vitest run charts`; null before its first. */
  now: string | null
  /**
   * How many files its own worktree changed since it started, committed or not; null for
   * `shared`, where its changes cannot be told apart from the parent's.
   */
  filesChanged: number | null
  /** What it reported back with `session_report`; null until it does. */
  result: string | null
  /**
   * Whether its own worktree is still on disk. It goes when the sub-session ends with nothing
   * changed, and when the parent stops or the ticket closes. Always false for `shared`.
   */
  worktreeKept: boolean
  /** Whether its branch is still in the repo, to be merged back. Always false for `shared`. */
  branchKept: boolean
}

/** The states in which a sub-session holds a seat, or is waiting for one. */
export const LIVE_SUB_SESSION_STATES: readonly SubSessionState[] = ['waiting', 'starting', 'working']

/** Whether a sub-session holds one of the Company's Session seats now. */
export function holdsSeat(sub: Pick<SubSessionInfo, 'state'>): boolean {
  return sub.state === 'starting' || sub.state === 'working'
}

/** The longest name and task kept, and what a report may carry. */
export const SUB_SESSION_NAME_MAX = 40
export const SUB_SESSION_TASK_MAX = 120
export const SUB_SESSION_RESULT_MAX = 4000
