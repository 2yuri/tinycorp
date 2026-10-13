/**
 * The packaged app's own proof that it starts (T166).
 *
 * `pnpm package:win` has built an installer since #361 and nobody had ever run what came out of it.
 * A build that cannot open its first window is the one failure no unit test can catch, and it is
 * exactly the failure a boss meets first — so CI starts the packaged `TinyCorp.exe` itself, with
 * this variable set, and the app opens no Company, loads its first window, says so and leaves.
 *
 * It is a variable rather than a flag because Electron owns `argv` and hands the app whatever is
 * left; a variable is read the same way whoever started the process.
 */

/** Set to anything non-empty to start the app, load one window and quit. */
export const SMOKE_ENV = 'TINYCORP_SMOKE'

/** The line the smoke run prints once the window has loaded. The runner looks for exactly this. */
export const SMOKE_READY = 'tinycorp: window loaded'

/**
 * The same thing written down, in the run's own user-data folder. A Windows GUI process is not
 * always given the console its parent is reading, so the run says it twice and the runner takes
 * either — a file is the half that cannot be lost to a subsystem's rules.
 */
export const SMOKE_READY_FILE = 'smoke-ready'

/** How long the window is given to load before the run is called a failure. */
export const SMOKE_TIMEOUT_MS = 60_000

/** Whether this process was started to prove the build starts, and nothing else. */
export function smokeRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[SMOKE_ENV] ?? '').trim() !== ''
}
