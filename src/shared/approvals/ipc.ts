/**
 * Approvals' slice of the IPC contract (T187). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { Approval, ApprovalDecision, ApprovalStatus, AutonomyLevel } from './index'

/** The current Company's autonomy level and Approvals, decided as the boss. Exposed as `window.tinyCorp.approvals`. */
export interface ApprovalApi {
  level(): Promise<Result<AutonomyLevel>>
  setLevel(level: AutonomyLevel): Promise<Result<AutonomyLevel>>
  /** Oldest first; only those with `status` when given. */
  list(status?: ApprovalStatus): Promise<Result<Approval[]>>
  decide(id: number, decision: ApprovalDecision): Promise<Result<Approval>>
  /** Fires after the level or any Approval changes, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
