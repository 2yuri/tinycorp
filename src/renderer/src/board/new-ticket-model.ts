import type { Column, NewTicket } from '../../../shared/domain/board'
import type { Priority } from '../../../shared/ticket-extras'

/** What the New Ticket modal holds while it is open (design `Y5daiS`). */
export interface TicketDraft {
  title: string
  description: string
  /** The column the action was taken in; `Start work immediately` overrides it. */
  column: Column
  /** The epic the board is scoped to, kept so the ticket lands under it. */
  epicId: number | null
  assigneeId: string
  repos: string[]
  priority: Priority
  labels: string[]
  baseBranch: string
  /** On only when an assignee can act on it. */
  startNow: boolean
}

/**
 * What `Start work immediately` does: the ticket is created in Doing with its assignee, which is
 * what already wakes them and cuts the worktree. Without it the ticket lands where the action was
 * taken, and an unclaimed ticket has nobody to start.
 */
export function startsInColumn(draft: TicketDraft): Column {
  return draft.startNow && draft.assigneeId.trim() ? 'doing' : draft.column
}

/** The draft as the engine takes it: blanks become null, so a repo default stays the default. */
export function newTicketInput(draft: TicketDraft): NewTicket {
  return {
    title: draft.title,
    description: draft.description,
    epicId: draft.epicId,
    column: startsInColumn(draft),
    assigneeId: draft.assigneeId.trim() || null,
    repos: draft.repos,
    priority: draft.priority,
    labels: draft.labels,
    baseBranch: draft.baseBranch.trim() || null,
  }
}

/**
 * The line under `Start work immediately`, as the frame writes it for Ada: who opens the worktree,
 * off which branch. Nobody is assigned yet, so say what would make the toggle mean something.
 */
export function startWorkNote(assignee: string | null, baseBranch: string): string {
  if (!assignee) return 'Pick an assignee to start the work as soon as the ticket is created.'
  const branch = baseBranch.trim() || 'the repo default'
  return `${assignee} opens a worktree off ${branch} and starts as soon as the ticket is created.`
}
