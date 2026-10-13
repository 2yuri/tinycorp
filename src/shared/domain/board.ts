import type { EpicColor, Priority } from '../ticket-extras'

/**
 * The kanban columns, in board order. `planning` comes first (T171): a ticket is planned in chat
 * before it is claimable, and `todo` — the column an approved plan lets it into — reads as Ready.
 * `testing` sits between `review` and `done` (T174): an approved review parks the ticket there
 * until whoever tests it says it passed, and only then does the merge gate rise.
 */
export const COLUMNS = ['planning', 'todo', 'doing', 'review', 'testing', 'done'] as const
export type Column = (typeof COLUMNS)[number]

/** The column a ticket is claimable from. Its id stays `todo`, so no ticket had to be moved. */
export const READY: Column = 'todo'

export const COLUMN_TITLES: Record<Column, string> = {
  planning: 'Planning',
  todo: 'Ready',
  doing: 'Doing',
  review: 'Review',
  testing: 'Testing',
  done: 'Done',
}

/** What the boss asked for, in one sentence. */
export interface Target {
  id: number
  title: string
  description: string
  /** The day it is due, `2026-09-25`, or null when the boss gave none. */
  dueAt: string | null
}

/** A feature: a PM grouping of tickets, usually under a Target. */
export interface Epic {
  id: number
  targetId: number | null
  title: string
  description: string
  /** The dot on its tickets' cards. */
  color: EpicColor
}

/** A checklist item inside a ticket, on the ticket's branch and PR. */
export interface Subtask {
  id: number
  ticketId: number
  title: string
  done: boolean
  /** The id of one of the ticket's repos, or null when the subtask is not tied to one. */
  repo: string | null
}

/** One assignee, one worktree and one PR per repo. Referenced in chat as `#<id>`. */
export interface Ticket {
  id: number
  epicId: number | null
  title: string
  description: string
  column: Column
  assigneeId: string | null
  /** Ids of the Company's repos in scope. */
  repos: string[]
  /** The manual flag, for what is outside the board; independent of `blockedBy`. */
  blocked: boolean
  blockedReason: string
  /** The tickets this one waits on (T266), in the order they were added. It waits while one is not Done. */
  blockedBy: number[]
  /** The tickets that wait on this one. */
  blocks: number[]
  subtasks: Subtask[]
  priority: Priority
  /** Free-form tags, in the order given, without duplicates. */
  labels: string[]
  /** The branch worktrees start from and PRs go into; null means each repo's default branch. */
  baseBranch: string | null
}

export interface ColumnState {
  id: Column
  title: string
  /** Null means no limit. */
  wipLimit: number | null
  count: number
  overLimit: boolean
}

/** Everything the board shows. Tickets are ordered by column, then position. */
export interface BoardSnapshot {
  columns: ColumnState[]
  targets: Target[]
  epics: Epic[]
  tickets: Ticket[]
}

export interface NewTarget {
  title: string
  description?: string
  /** A day, `2026-09-25`. */
  dueAt?: string | null
}

export interface NewEpic {
  title: string
  description?: string
  targetId?: number | null
  /** The palette in turn when omitted. */
  color?: EpicColor
}

export interface NewTicket {
  title: string
  description?: string
  epicId?: number | null
  column?: Column
  assigneeId?: string | null
  repos?: string[]
  /** `normal` when omitted. */
  priority?: Priority
  labels?: string[]
  /** Each repo's default branch when omitted, null or blank. */
  baseBranch?: string | null
}

export interface NewSubtask {
  ticketId: number
  title: string
  /** When given, must be the ticket's assignee: another person means another ticket. */
  assigneeId?: string | null
  /** When given, must be one of the ticket's repos: another repo means another ticket. */
  repo?: string | null
}

export type TargetChanges = Partial<Pick<Target, 'title' | 'description' | 'dueAt'>>
export type EpicChanges = Partial<Pick<Epic, 'title' | 'description' | 'targetId' | 'color'>>
export type TicketChanges = Partial<
  Pick<
    Ticket,
    | 'title'
    | 'description'
    | 'epicId'
    | 'assigneeId'
    | 'repos'
    | 'blocked'
    | 'blockedReason'
    | 'priority'
    | 'labels'
    | 'baseBranch'
  >
>
export type SubtaskChanges = Partial<Pick<Subtask, 'title' | 'done' | 'repo'>> & {
  assigneeId?: string | null
}

/** One edit to the board, as the renderer sends it. */
export type BoardCommand =
  | { kind: 'createTarget'; input: NewTarget }
  | { kind: 'updateTarget'; id: number; changes: TargetChanges }
  | { kind: 'createEpic'; input: NewEpic }
  | { kind: 'updateEpic'; id: number; changes: EpicChanges }
  | { kind: 'createTicket'; input: NewTicket }
  | { kind: 'updateTicket'; id: number; changes: TicketChanges }
  | { kind: 'moveTicket'; id: number; column: Column; index?: number }
  | { kind: 'createSubtask'; input: NewSubtask }
  | { kind: 'updateSubtask'; id: number; changes: SubtaskChanges }
  | { kind: 'deleteSubtask'; id: number }
  | { kind: 'setWipLimit'; column: Column; limit: number | null }
  | { kind: 'addBlocker'; id: number; blockedById: number }
  | { kind: 'removeBlocker'; id: number; blockedById: number }
