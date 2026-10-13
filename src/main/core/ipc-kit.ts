import type { Result } from '../../shared/domain/result'

/**
 * The few things every IPC module needs and none of them owns: the slice of Electron's `ipcMain`
 * a handler registers on, and the two guards that turn whatever the renderer sent into something
 * the engine can be called with.
 *
 * They lived in `company-ipc.ts` until T184, which meant forty-odd IPC modules imported the
 * Company feature to get at `attempt`. Nothing here knows about a Company, a Session or a ticket;
 * it is the kit the seam is built from, so it sits below the features rather than inside one.
 */

/** The slice of Electron's `ipcMain` an IPC module needs. */
export interface IpcHandlerRegistry {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Runs `action` and answers the renderer with what happened.
 *
 * Every IPC handler is a trust boundary: the input came from another process, and a throw here
 * would cross it as an unhandled rejection with a stack in it. Expected failures — a folder that
 * is gone, a name that is taken — come back as `{ ok: false, error }` for the screen to say out
 * loud (`docs/engineering.md`).
 */
export function attempt<T>(action: () => T): Result<T> {
  try {
    return { ok: true, value: action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** {@link attempt} for an action that answers later: a rejection is a failed Result, never a throw. */
export async function attemptAsync<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The string `value` is, or a refusal naming `what`. Parse at the boundary, never cast past it. */
export function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Missing ${what}`)
  return value
}

/** Whether `value` can be read by key at all; the first question of every object the renderer sends. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
