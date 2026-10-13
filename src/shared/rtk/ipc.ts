/**
 * RTK's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { RtkHookRow, RtkSavings, RtkSettings, RtkStatus } from './index'

/**
 * RTK, the command-output compressor every Employee's shell commands run through (T179). Exposed as
 * `window.tinyCorp.rtk`.
 *
 * Nothing here installs anything: the boss runs one line in their own terminal and presses
 * `Check again`. The savings are RTK's own estimate and are never mixed with the usage bars.
 */
export interface RtkApi {
  /** Where RTK stands on this machine, and what this Company does with it. */
  read(): Promise<Result<RtkView>>
  /** `Check again`: looks for RTK again and reports what it found. */
  recheck(): Promise<Result<RtkView>>
  /** Turns command-output compression on or off for this Company. Takes at the next Session start. */
  setEnabled(enabled: boolean): Promise<Result<RtkSettings>>
  /** Turns RTK's own anonymous daily ping on or off for this Company's Sessions. */
  setPing(ping: boolean): Promise<Result<RtkSettings>>
  /** What RTK says this Company saved this week, or null when it could not be read. */
  savings(): Promise<Result<RtkSavings | null>>
  /** Fires when the status or the toggles change, and on Company switch. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
}

/** Everything the Tokens tab draws from, in one read. */
export interface RtkView {
  status: RtkStatus
  settings: RtkSettings
  /** How each Provider hooks in, in catalogue order. */
  hooks: RtkHookRow[]
}
