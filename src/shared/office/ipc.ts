/**
 * The office's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices
 * into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { OfficeFacts } from './projection'
import type { RoomSlug } from './rooms'

/** What the current Company's office is projected from. Exposed as `window.tinyCorp.office`. */
export interface OfficeApi {
  facts(): Promise<Result<OfficeFacts>>
  /** The room the Company works in (T83). */
  room(): Promise<Result<RoomSlug>>
  /** Picks the room. It shows on the next office render; Sessions keep running. */
  setRoom(slug: RoomSlug): Promise<Result<RoomSlug>>
  /** Fires after anything the office shows may have changed, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
