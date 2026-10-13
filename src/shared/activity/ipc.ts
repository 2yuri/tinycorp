/**
 * The activity log's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the
 * slices into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { ActivityActor, ActivityEvent, ActivityQuery } from './index'

/** The current Company's append-only activity log (decision 36). Exposed as `window.tinyCorp.activity`. */
export interface ActivityApi {
  /** Newest first, filtered by kind group, Employee and free text. */
  list(query?: ActivityQuery): Promise<Result<ActivityEvent[]>>
  /** Everyone with an event in the log, for the Employee filter. */
  actors(): Promise<Result<ActivityActor[]>>
  /** Fires after an event lands and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
