/**
 * Restore points' slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices
 * into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { RestoreLoss, RestorePoint } from './index'

/** A ticket's restore points and the way back to one (T118). Exposed as `window.tinyCorp.restorePoints`. */
export interface RestorePointsApi {
  /** One ticket's restore points, newest first. */
  of(ticketId: number): Promise<Result<RestorePoint[]>>
  /** What going back to a point would throw away, for the confirmation. */
  losses(id: string): Promise<Result<RestoreLoss>>
  /** Stops whoever is working on the ticket, then puts that worktree back. */
  goBack(id: string): Promise<Result<RestorePoint>>
  /** Fires after a point is taken or dropped, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
