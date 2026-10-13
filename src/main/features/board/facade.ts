import type { CurrentCompany } from '../company'
import type { Board } from './board'
import type { TicketRemovals } from './ticket-removal'

/**
 * The Board screen's face on the engine (T188).
 *
 * Its IPC module names this rather than the whole engine, so what the board can reach never widens
 * because another feature grew a member. The current Company is on it because the screen draws
 * ticket codes, and a code is the Company's key.
 */
export interface BoardFacade extends CurrentCompany {
  /** The board of the current Company. Throws when no Company is open. */
  board(): Board
  /** Deleting a ticket of the current Company: the boss's own action (T275). Throws when none is open. */
  ticketRemovals(): TicketRemovals
  /** Called after any edit to any open Company's board. Returns an unsubscribe function. */
  onBoardChange(listener: () => void): () => void
}
