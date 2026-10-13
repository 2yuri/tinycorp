/**
 * The Sandbox add-on's slice of the IPC contract (T186, T260). `src/shared/ipc/index.ts` composes
 * the slices into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { SandboxCommand, SandboxSettings, SandboxStatus } from './index'

/**
 * The Sandbox add-on, which runs every Employee's Session inside ai-jail (T260). Exposed as
 * `window.tinyCorp.sandbox`.
 *
 * Nothing here installs anything, and nothing here ships ai-jail: it is GPL-3.0-only, found on the
 * runtime's `PATH` and run as a separate program. The boss runs one line in their own terminal and
 * presses `Check again`.
 */
export interface SandboxApi {
  /** Where ai-jail stands on this machine, and what this Company does with it. */
  read(): Promise<Result<SandboxView>>
  /** `Check again`: looks for ai-jail again and reports what it found. */
  recheck(): Promise<Result<SandboxView>>
  /** Turns the add-on on or off for this Company. Takes at each Employee's next Session start. */
  setEnabled(enabled: boolean): Promise<Result<SandboxSettings>>
  /** Fires when the status or the toggle changes, and on Company switch. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
}

/** Everything the Sandbox card draws from, in one read. */
export interface SandboxView {
  status: SandboxStatus
  settings: SandboxSettings
  /** The line the boss runs, or none at all on a machine where there is nothing to install. */
  install: SandboxCommand[]
}
