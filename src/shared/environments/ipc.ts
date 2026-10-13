/**
 * The Environments' slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices
 * into `TinyCorpApi`, so preload and the renderer keep importing one contract.
 */

import type { Result } from '../domain/result'
import type { EnvironmentId, EnvironmentSettings, ImportPreview } from './index'

/**
 * The Company's Environments (T176, frames `zpvHQ` and `aD50i`). Exposed as
 * `window.tinyCorp.environments`.
 *
 * Only two calls here ever carry a value, and both are the boss's own: {@link EnvironmentApi.add}
 * and {@link EnvironmentApi.update} carry one *in*, typed by the boss, and {@link
 * EnvironmentApi.reveal} carries one *out*, after the OS has asked who is there. Importing a
 * `.env` carries none in either direction: the file is read in the main process and only its keys
 * cross.
 */
export interface EnvironmentApi {
  /** The three environments, their variables, the repos, in one read. Never a value. */
  get(): Promise<Result<EnvironmentSettings>>
  setAskEveryUse(environment: EnvironmentId, on: boolean): Promise<Result<EnvironmentSettings>>
  setAvailableToChecks(environment: EnvironmentId, on: boolean): Promise<Result<EnvironmentSettings>>
  /** Adds a variable. The value goes straight to the OS secret store and is not kept here. */
  add(input: {
    environment: EnvironmentId
    name: string
    value: string
    repoIds?: string[]
  }): Promise<Result<EnvironmentSettings>>
  update(
    id: string,
    patch: { environment?: EnvironmentId; name?: string; value?: string; repoIds?: string[] },
  ): Promise<Result<EnvironmentSettings>>
  remove(id: string): Promise<Result<EnvironmentSettings>>
  /** Which environment a repo runs by default; null for none. */
  setRepoDefault(repoId: string, environment: EnvironmentId | null): Promise<Result<EnvironmentSettings>>
  /** Asks the OS who is there, then answers with the value to show for a few seconds. */
  reveal(id: string): Promise<Result<RevealedValue>>
  /** Asks the OS, puts the value on the clipboard, and takes it back 30 seconds later. */
  copy(id: string): Promise<Result<{ protection: RevealProtection }>>
  /** Opens the file dialog and previews the chosen `.env`; null when the boss cancelled. */
  pickEnvFile(environment: EnvironmentId): Promise<Result<ImportPreview | null>>
  /** Imports the ticked keys of the file just previewed. The values never crossed to the renderer. */
  importKeys(environment: EnvironmentId, names: string[]): Promise<Result<EnvironmentSettings>>
  /** Fires after anything changes, and on Company switch. */
  onChanged(listener: () => void): () => void
}

/** How the OS asked who is there before a value was revealed or copied. */
export type RevealProtection = 'touch-id' | 'confirmation'

/** What Reveal answers: the value, and how the boss was asked for it. */
export interface RevealedValue {
  name: string
  value: string
  protection: RevealProtection
}
