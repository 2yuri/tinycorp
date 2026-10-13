import { isAtWork } from '../../../shared/office/at-work'
import { NO_DESK_REASON, type OfficeSprite } from '../../../shared/office/projection'

/** Avatars in the header's presence stack before the rest collapse into `+N`. */
export const PRESENCE_MAX = 4

export interface OfficeHeaderFacts {
  /** Employees whose Session is on and getting prompts, whatever they are doing. */
  atWork: number
  /** Of those, the ones sitting at their own desk. */
  atDesks: number
  /**
   * Employees standing at the boss desk with a `!`: an Approval of theirs is undecided. The menu-bar
   * item says the same number while the window is closed (T117).
   */
  waitingOnYou: number
  /** The avatars to show, people at work first. */
  presence: OfficeSprite[]
  /** Employees left out of `presence`. */
  more: number
  /**
   * Employees the room had no desk for: they wait at the coffee counter (T101). More than none means
   * the room is full, and the way out is a bigger room in Company settings, not another desk.
   */
  noDesk: number
  full: boolean
}

/** The office header's counts and presence stack, from the projected office. */
export function officeHeaderFacts(sprites: OfficeSprite[]): OfficeHeaderFacts {
  const working = sprites.filter((s) => isAtWork(s.state))
  const ordered = [...working, ...sprites.filter((s) => !isAtWork(s.state))]
  const noDesk = sprites.filter((s) => !s.seat && s.state !== 'off').length
  return {
    atWork: working.length,
    atDesks: working.filter((s) => !s.away).length,
    waitingOnYou: sprites.filter((s) => s.state === 'waiting').length,
    presence: ordered.slice(0, PRESENCE_MAX),
    more: Math.max(0, ordered.length - PRESENCE_MAX),
    noDesk,
    full: noDesk > 0,
  }
}

/** What the header says while the room is full: `Room full · 2 waiting for a desk`. */
export function fullLabel(facts: Pick<OfficeHeaderFacts, 'noDesk'>): string {
  return `Room full · ${facts.noDesk} ${NO_DESK_REASON.toLowerCase()}`
}

export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
