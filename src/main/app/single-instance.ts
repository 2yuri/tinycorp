/**
 * One copy of the app per user-data folder (T252).
 *
 * Two copies of TinyCorp are two processes writing the same `company.sqlite`. Nothing in the app is
 * built for that: the second copy's Launcher reads every Company's database on its own refresh, and
 * on Windows that read is enough to make the first copy's create fail with `database is locked` —
 * which is easy to arrive at, because the one-click installer launches the app when it finishes and
 * the boss who then clicks the shortcut has two.
 *
 * Electron's lock is per user-data folder, so it is the app a boss runs that is single, not every
 * build on the machine: `pnpm test:e2e` and `tools/smoke-packaged.mjs` each pass their own
 * `--user-data-dir` and never meet the boss's copy or each other.
 *
 * It behaves the same on all three platforms — the second copy quits and the first comes forward —
 * which is what a Windows or Linux boss expects of a shortcut and what a Mac boss already gets from
 * the Dock. On macOS the launch of a second copy is rare (Launchpad activates the running app
 * instead), and the one way it happens — `open -n`, or a second `.app` in another folder — lands
 * here too.
 */

/** The bits of Electron's `app` this needs. Electron's own satisfies it. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): void
  quit(): void
}

export interface SingleInstanceOptions {
  app: SingleInstanceApp
  /** Brings a window to the front, creating one when there is none. */
  showWindow(): void
}

/**
 * Whether this copy may carry on. False when another already has the lock, and then the caller
 * quits without opening a window: `app.quit()` has been called and nothing else should run.
 */
export function holdSingleInstance({ app, showWindow }: SingleInstanceOptions): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  // Somebody started the app again: their click asked for a window, so they get this one.
  app.on('second-instance', () => showWindow())
  return true
}
