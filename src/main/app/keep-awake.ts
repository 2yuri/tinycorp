import { KEEP_AWAKE_DEFAULT, type KeepAwakeMode, type KeepAwakeState } from '../../shared/app/keep-awake'
import { createWakeLock, type StartAssertion } from '../platform'

/**
 * How long the floor stays awake after the last Session stops. A burst of starts and stops is one
 * hold, not a dozen: the assertion costs a process, and the room is not really quiet yet.
 */
export const QUIET_MS = 30_000

/** Where the boss's mode is kept: a file in `userData`, beside the boss profile. */
export interface KeepAwakeStore {
  read(): KeepAwakeMode | null
  write(mode: KeepAwakeMode): void
}

export interface KeepAwakeOptions {
  store: KeepAwakeStore
  /** How the machine is held awake; the app hands in `startPowerSaveBlocker`, tests count. */
  start: StartAssertion
  /**
   * Whether this machine can be held awake at all. It is a switch rather than a platform because
   * a headless or unsupported desktop is the only case left now that the assertion itself works
   * on all three (T177); the app leaves it on.
   */
  supported?: boolean
  /** Called whenever the mode or the hold changes, so every window can redraw the cup. */
  onChanged?(state: KeepAwakeState): void
  setTimer?(run: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

/**
 * The one place that decides whether this machine may sleep (T99, T177). It owns the boss's mode,
 * listens to the floor, and holds a single power-save assertion for as long as the mode says to —
 * on macOS, on Windows and on Linux alike, because `powerSaveBlocker` is all three.
 */
export interface KeepAwake {
  state(): KeepAwakeState
  setMode(mode: KeepAwakeMode): void
  /** The floor moved: whether any Employee, in any open Company, has a Session running. */
  setWorking(working: boolean): void
  /** The app is quitting: let go of everything, timers included. */
  close(): void
}

export function createKeepAwake(options: KeepAwakeOptions): KeepAwake {
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout))
  const supported = options.supported ?? true
  const wake = createWakeLock({ start: options.start })

  let mode = options.store.read() ?? KEEP_AWAKE_DEFAULT
  let working = false
  /** The wait between the last Session stopping and letting go, while one is running. */
  let quiet: unknown = null
  /** Off while a single change settles, so one boss action is one announcement. */
  let announcing = false

  const state = (): KeepAwakeState => ({ mode, holding: wake.awake(), supported })
  const announce = () => announcing && options.onChanged?.(state())

  function cancelQuiet() {
    if (quiet === null) return
    clearTimer(quiet)
    quiet = null
  }

  /** Whether the mode wants this machine awake right now, on a machine that can be held awake. */
  function wanted(): boolean {
    return supported && (mode === 'on' || (mode === 'working' && working))
  }

  function change(act: () => void) {
    const before = wake.awake()
    act()
    if (wake.awake() !== before) announce()
  }

  function settle() {
    if (wanted()) {
      cancelQuiet()
      return change(() => wake.hold('office'))
    }
    if (mode === 'working' && wake.awake()) {
      // The floor just went quiet: give it a moment before letting go.
      quiet ??= setTimer(() => {
        quiet = null
        change(() => wake.release('office'))
      }, QUIET_MS)
      return
    }
    cancelQuiet()
    change(() => wake.release('office'))
  }

  settle()
  announcing = true

  return {
    state,
    setMode(next) {
      if (next === mode) return
      mode = next
      options.store.write(mode)
      announcing = false
      settle()
      announcing = true
      announce()
    },
    setWorking(next) {
      if (next === working) return
      working = next
      settle()
    },
    close() {
      cancelQuiet()
      wake.releaseAll()
    },
  }
}
