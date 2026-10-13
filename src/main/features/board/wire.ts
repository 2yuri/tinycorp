import { BOSS } from '../../../shared/domain/chat'
import type { CompanyContext, OpenCompany } from '../../core'
import type { GitService } from '../../platform'
import { type ActivityContext, recordTicketDeleted } from '../activity'
import type { NewInboxItem } from '../inbox'
import type { ActingBoard } from '../sessions'
import { type Board, createBoard } from './board'
import type { BoardFacade } from './facade'
import { createTicketRemovals, type TicketRemovalsOptions } from './ticket-removal'

/** What a ticket goes through the moment it is created, and what redraws when one moves. */
export interface BoardDeps {
  /**
   * That Company's board with its worktrees on top: every caller edits through it, so a ticket
   * moved anywhere makes its branch, opens its PR and wakes whoever it now concerns.
   */
  code(entry: OpenCompany): { boardAs(actorId: string): ActingBoard }
  /** A new ticket or epic opens its plan and wakes the planner, whoever created it (T171). */
  planning(entry: OpenCompany): {
    ticketCreated(ticket: { id: number }, actorId: string): void
    epicCreated(epic: { id: number }, actorId: string): void
  }
  /** Deleting a ticket turns down the Approvals still waiting on it (T275). */
  approvals(entry: OpenCompany): TicketRemovalsOptions['approvals']
  /** Deleting a ticket drops its restore points first, since they point at its row. */
  restorePoints(entry: OpenCompany): { forgetTicket(ticketId: number): void }
  /** That Company's roster, to name who held a deleted ticket. */
  staff(entry: OpenCompany): { employees: { list(): { id: string; name: string }[] } }
  /** Files an inbox item for that Company: whoever held a deleted ticket is told to drop it. */
  deliver(companyId: string, item: NewInboxItem): void
  /** How the activity log names who acted. */
  activity(entry: OpenCompany): () => ActivityContext
  /** Without one, a deleted ticket has no worktree to read or remove. */
  git?: GitService
  log(line: string): void
}

/** The board feature, once it is wired. */
export interface BoardFeature {
  /** That Company's plain board: the rows, with none of the wrapping below. */
  of(entry: OpenCompany): Board
  /** The board every caller edits through, acting as somebody. */
  as(entry: OpenCompany, actorId: string): ActingBoard
  /** Something edited a board, in any open Company: the office, Files and Testing all follow it. */
  changed(): void
  onChange(listener: () => void): () => void
  facade: Pick<BoardFacade, 'board' | 'ticketRemovals' | 'onBoardChange'>
}

/**
 * Wires the board to the Companies the app has open (T201).
 *
 * `of` is the rows and nothing else — what a brief, an office desk or a capture reads. `as` is the
 * board a *caller* edits through: the code flow's, which makes worktrees and opens PRs, with
 * planning's own hooks on top. Nothing edits a ticket except through `as`, which is why a move is
 * never silent.
 */
export function register(ctx: CompanyContext, deps: BoardDeps): BoardFeature {
  const changed = ctx.listeners()
  const boards = ctx.perCompany((entry) => createBoard(entry.db, () => changed.notify()))
  // Made on first use, by which time every feature it reaches for exists.
  const removals = ctx.perCompany((entry) =>
    createTicketRemovals({
      db: entry.db,
      ...(deps.git && { git: deps.git }),
      approvals: deps.approvals(entry),
      forgetRestorePoints: (ticketId) => deps.restorePoints(entry).forgetTicket(ticketId),
      nameOf: (id) =>
        deps
          .staff(entry)
          .employees.list()
          .find((employee) => employee.id === id)?.name ?? null,
      deliver: (item) => deps.deliver(entry.company.id, item),
      onDeleted: (input) => recordTicketDeleted(deps.activity(entry), { ...input, actorId: BOSS }),
      onChange: () => changed.notify(),
      log: deps.log,
    }),
  )

  function as(entry: OpenCompany, actorId: string): ActingBoard {
    const board = deps.code(entry).boardAs(actorId)
    const planning = deps.planning(entry)
    return {
      ...board,
      createTicket(input) {
        const ticket = board.createTicket(input)
        planning.ticketCreated(ticket, actorId)
        return ticket
      },
      createEpic(input) {
        const epic = board.createEpic(input)
        planning.epicCreated(epic, actorId)
        return epic
      },
    }
  }

  return {
    of: (entry) => boards.of(entry),
    as,
    changed: () => changed.notify(),
    onChange: (listener) => changed.add(listener),
    facade: {
      board: () => as(ctx.currentEntry(), BOSS),
      ticketRemovals: () => removals.of(ctx.currentEntry()),
      onBoardChange: (listener) => changed.add(listener),
    },
  }
}
