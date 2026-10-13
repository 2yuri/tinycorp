/**
 * The board: tickets, the columns they move through, and the WIP limit on each one.
 *
 * The feature's front door. A ticket is only ever edited through an `ActingBoard` — the board with
 * whoever is acting on it named — so the wakes, the plan and the code flow all hear about a move;
 * `features/sessions/ticket-wakes.ts` is where that wrapping happens. What a ticket *is*, and the
 * words the Board screen draws, are in `src/shared/domain/board.ts` and `src/shared/ticket-*.ts`.
 */

export { BOARD_MIGRATION, type Board, TARGET_DUE_MIGRATION, TESTING_COLUMN_MIGRATION } from './board'
export { averageStay, COLUMN_ENTRIES_MIGRATION } from './column-entries'
export type { BoardFacade } from './facade'
export { registerBoardIpc } from './ipc'
export { TICKET_EXTRAS_MIGRATION } from './ticket-extras'
export { TICKET_LINKS_MIGRATION } from './ticket-links'
export { registerBoardTools } from './tools'
export { register as registerBoard } from './wire'
