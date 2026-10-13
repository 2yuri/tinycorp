/**
 * Notifications' slice of the IPC contract (T186).
 *
 * The feature owns the words the two processes use for it; `src/shared/ipc/index.ts` composes the
 * slices into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { NotificationDelivery, NotificationFocus } from './index'

/** Where a clicked notification asks the renderer to go, once its Company is current. */
export interface NotificationFocusRequest {
  companyId: string
  focus: NotificationFocus
}

/** The current Company's native notification toggle, and clicks on notifications. Exposed as `window.tinyCorp.notifications`. */
export interface NotificationApi {
  enabled(): Promise<Result<boolean>>
  setEnabled(enabled: boolean): Promise<Result<boolean>>
  /**
   * Posts a banner that says it is a test, and answers with what the system did with it: the one
   * thing that tells the boss whether the silence is the app's or the system's (T126).
   */
  test(): Promise<Result<NotificationDelivery>>
  /** What became of the last notification this app handed to the system, or null when none has been. */
  delivery(): Promise<Result<NotificationDelivery | null>>
  /** Opens System Settings → Notifications at this app. False where the platform has no such pane. */
  openSystemSettings(): Promise<Result<boolean>>
  /** Fires after the toggle changes, after a delivery, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
  /** Fires when the boss clicks a notification. Returns an unsubscribe function. */
  onFocus(listener: (request: NotificationFocusRequest) => void): () => void
}
