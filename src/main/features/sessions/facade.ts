import type { BuildStyle } from '../../../shared/build-style'
import type { CavemanLevel } from '../../../shared/caveman'
import type { AppliedNow, StaleSession } from '../../../shared/spawn-settings'
import type { CompanyChanged } from '../company'
import type { Staff } from '../staff'
import type { Capacity } from './capacity'
import type { PausableSessions } from './pause'
import type { Terminals } from './terminals'

/**
 * A Session, as the screens that watch one see it (T188).
 *
 * Four faces rather than one, because four screens watch different halves: the Employees view
 * wants the Sessions, the drawer's terminal wants the PTYs, the capacity popover wants the cap,
 * and Company settings' Add-ons tab wants the one setting that changes what a Session is told.
 */
export interface SessionsFacade {
  /** Employees' Sessions and their hook-driven status, with the Company's Pause all and Resume all. */
  sessions: PausableSessions
}

/** The Employee drawer's terminal: the live PTY, and who it belongs to. */
export interface TerminalsFacade {
  /** Employees' live terminals: output, input and size. */
  terminals: Terminals
  /** The current Company's Employees, to name the terminal's owner. */
  employees: Staff
}

/** The capacity popover's face. */
export interface CapacityFacade extends CompanyChanged {
  /** The current Company's concurrency cap and parked Employees, and the app's budget state. */
  capacity: Capacity
}

/**
 * What every settings card that a Session bakes in shares (T237): who is still on the old setting,
 * and the `Apply now` beside the note.
 */
export interface SpawnSettingsFacade {
  spawnSettings: {
    stale(): StaleSession[]
    applyNow(): AppliedNow
    /** What saving an Employee does to its running Session (T268); called when the staff changes. */
    applyEdits(): AppliedNow
    onChange(listener: () => void): () => void
  }
}

/**
 * The Add-ons tab's face: how the current Company's Employees build (T194). Read at every spawn
 * and nowhere else, so turning Lean builder off removes the section at the next Session start
 * rather than mid-turn.
 */
export interface BuildStyleFacade {
  buildStyle: {
    get(): BuildStyle
    set(style: BuildStyle): BuildStyle
  }
}

/**
 * The Add-ons tab's other face: how the current Company's Employees answer the boss (T261). Read
 * at every spawn and nowhere else, like the build style above it.
 */
export interface CavemanFacade {
  caveman: {
    get(): CavemanLevel
    set(level: CavemanLevel): CavemanLevel
  }
}
