/**
 * The inbox's slice of the IPC contract (T187). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { AnswererSetting } from './answerer'
import type { InboxItem } from './index'

/** Employees' inboxes in the current Company. Exposed as `window.tinyCorp.inbox`. */
export interface InboxApi {
  /** An Employee's pending and handled items, oldest first. */
  list(employeeId: string): Promise<Result<InboxItem[]>>
  /** Fires after any inbox change and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** The current Company's "Who answers you" setting (decision 41). Exposed as `window.tinyCorp.answerer`. */
export interface AnswererApi {
  get(): Promise<Result<AnswererSetting>>
  /** Picks the Employee who answers unaddressed boss messages; null goes back to Automatic. */
  set(employeeId: string | null): Promise<Result<AnswererSetting>>
  /** Fires after the setting, the staff or availability changes it, and on Company switch. */
  onChanged(listener: () => void): () => void
}
