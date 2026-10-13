import type { PowerSaveBlocker } from 'electron'
import type { WakeAssertion } from './wake-lock'

/**
 * The one way the app holds a machine awake, on all three platforms (T99, T177).
 *
 * It used to be `caffeinate -di`, which is a macOS command and a whole child process: the mug on
 * the map only appeared on a Mac, and a Windows or Linux boss watching a night of work lost it to
 * a screen lock. Electron's `powerSaveBlocker` is the same assertion through the platform's own
 * API — IOPMAssertion on macOS, `SetThreadExecutionState` on Windows, and the freedesktop
 * inhibit portal or the X screensaver on Linux — so there is one call and it works everywhere.
 *
 * `prevent-display-sleep` is the stronger of the two kinds: it stops the display blanking, and
 * a machine whose display stays on does not idle to sleep either. That is what `-di` asked for.
 *
 * The assertion is owned by this process, so it dies with the app: nothing can outlive a crash
 * the way a spawned `caffeinate` could.
 */
export function startPowerSaveBlocker(powerSaveBlocker: PowerSaveBlockerApi): WakeAssertion {
  const id = powerSaveBlocker.start('prevent-display-sleep')
  return {
    release() {
      // A desktop with no inhibitor at all — a bare Linux session with no portal — hands back an
      // id that was never started. Stopping it is then a no-op, not a throw in the office.
      if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id)
    },
  }
}

/**
 * The three calls this needs, handed in by the composition root rather than imported here: the
 * platform barrel is loaded by code that runs in plain Node too — the capture harnesses' vite
 * configs load the Files feature, which reaches git through this barrel (T259) — and a named
 * import of `electron` outside Electron is a SyntaxError at load time, long before anything calls it.
 */
export type PowerSaveBlockerApi = Pick<PowerSaveBlocker, 'start' | 'isStarted' | 'stop'>
