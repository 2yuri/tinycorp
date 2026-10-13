/**
 * The ticket drawer's form, as data (T214).
 *
 * The drawer used to hold eleven `useState` — one per field — so every reader of the form had to
 * know which eleven, and Save read them one at a time. It is one draft now, patched by one reducer,
 * and what Save writes is a pure function of it: `ticketChanges` is the only place that says which
 * fields a ticket update carries.
 */
import type { Column, Ticket } from '../../../shared/domain/board'
import type { Priority } from '../../../shared/ticket-extras'

/** Everything the drawer's ticket form holds while the boss is filling it in. */
export interface TicketDraft {
  title: string
  description: string
  epicId: number | null
  column: Column
  /** Empty means unclaimed; an id that is nobody's any more still shows, so it can be changed. */
  assigneeId: string
  /** Null until the boss picks, so a ticket follows the repos list as it loads. */
  picked: string[] | null
  /** True once Save has been pressed with no repo picked; until then the field says nothing. */
  showRepoError: boolean
  blocked: boolean
  blockedReason: string
  priority: Priority
  labels: string[]
  /** Empty means each repo's own default branch. */
  baseBranch: string
}

/** The form as the ticket opens it. */
export function ticketDraft(ticket: Ticket): TicketDraft {
  return {
    title: ticket.title,
    description: ticket.description,
    epicId: ticket.epicId,
    column: ticket.column,
    assigneeId: ticket.assigneeId ?? '',
    picked: null,
    showRepoError: false,
    blocked: ticket.blocked,
    blockedReason: ticket.blockedReason,
    priority: ticket.priority,
    labels: ticket.labels,
    baseBranch: ticket.baseBranch ?? '',
  }
}

/**
 * One reducer for a whole form: a field change is a patch of the draft it belongs to. Typed, so a
 * field that is not on the draft — or a value of the wrong kind — fails the build rather than
 * quietly adding a key nothing reads.
 */
export function patchDraft<T extends object>(draft: T, change: Partial<T>): T {
  return { ...draft, ...change }
}

/** What Save writes. `repos` is the scope the chips are showing, which the draft may not hold yet. */
export function ticketChanges(draft: TicketDraft, repos: string[]): Partial<Ticket> {
  return {
    title: draft.title,
    description: draft.description,
    epicId: draft.epicId,
    assigneeId: draft.assigneeId.trim() || null,
    repos,
    priority: draft.priority,
    labels: draft.labels,
    baseBranch: draft.baseBranch.trim() || null,
    blocked: draft.blocked,
    blockedReason: draft.blockedReason,
  }
}
