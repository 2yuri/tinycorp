/**
 * A held wake assertion: while it lives the machine neither idles to sleep nor blanks its display.
 * Releasing it gives sleep back.
 */
export interface WakeAssertion {
  release(): void
}

/**
 * Starts one assertion. The whole platform seam, and the reason this module imports no Electron:
 * the app hands in `startPowerSaveBlocker` (`power-save-blocker.ts`), every test hands in a
 * counter, and neither this file nor `keep-awake.ts` knows which it got.
 */
export type StartAssertion = () => WakeAssertion

export interface WakeLockOptions {
  /** How an assertion is taken. Required: there is no platform default hidden in here. */
  start: StartAssertion
  /** Fires when the lock takes or gives back its assertion, never on a no-op hold. */
  onChanged?(awake: boolean): void
}

/**
 * One wake assertion for the whole app, held for as long as at least one holder wants it: a
 * window that is full screen, and no longer. Holders are counted by name, so a window toggling
 * full screen twice or a second Company window entering it never takes a second assertion.
 */
export interface WakeLock {
  /** Holds the assertion for `holder`. Holding twice for the same holder changes nothing. */
  hold(holder: string): void
  release(holder: string): void
  /** The app is quitting or the last window went: nothing may outlive us. */
  releaseAll(): void
  awake(): boolean
}

export function createWakeLock(options: WakeLockOptions): WakeLock {
  const { start } = options
  const holders = new Set<string>()
  let assertion: WakeAssertion | null = null

  function settle() {
    if (holders.size > 0 && !assertion) {
      assertion = start()
      options.onChanged?.(true)
    } else if (holders.size === 0 && assertion) {
      assertion.release()
      assertion = null
      options.onChanged?.(false)
    }
  }

  return {
    hold(holder) {
      holders.add(holder)
      settle()
    },
    release(holder) {
      holders.delete(holder)
      settle()
    },
    releaseAll() {
      holders.clear()
      settle()
    },
    awake: () => assertion !== null,
  }
}
