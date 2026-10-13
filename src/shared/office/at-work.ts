/**
 * The one rule for "is this Employee at work?", shared by the floor, the office header and the
 * menu-bar item (T117).
 *
 * `off`, `parked` and `out_of_budget` name the same thing in a Session's status and in the sprite
 * state it produces: the office's precedence table reads those three before anything else, so an
 * Employee in one of them can be in no other. That is what lets one rule answer for both, and it is
 * why the menu bar can say `3 at work` without ever projecting a room.
 */
import type { SessionStatus } from '../session'
import type { SpriteState } from './reading'

/** Off, or alive but getting no prompts: nobody in these is at work. */
export type NotAtWork = 'off' | 'parked' | 'out_of_budget'

export const NOT_AT_WORK: readonly NotAtWork[] = ['off', 'parked', 'out_of_budget']

/** Whether a Session status, or the sprite state it produced, counts as at work. */
export function isAtWork(state: SessionStatus | SpriteState): boolean {
  return !(NOT_AT_WORK as readonly string[]).includes(state)
}

/** How many Employees are at work. Whoever is missing from `sessions` has no Session. */
export function countAtWork(sessions: Record<string, SessionStatus>): number {
  return Object.values(sessions).filter(isAtWork).length
}

/**
 * Employees the office stands at the boss desk with a `!`: something of theirs is waiting on the
 * boss — an undecided Approval, or a Session stopped in its terminal to ask before it acts (T165) —
 * and their Session is on. Whoever is parked or out of budget is read as that instead, exactly as
 * the precedence table reads them, so this is the count the floor draws.
 */
export function countWaitingOnYou(sessions: Record<string, SessionStatus>, requesterIds: Iterable<string>): number {
  return [...new Set(requesterIds)].filter((id) => isAtWork(sessions[id] ?? 'off')).length
}
