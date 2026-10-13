import type { Unavailability } from '../domain/staff'

/**
 * The "Who answers you" setting of a Company and what the chain makes of it (decision 41), as
 * Company settings show it.
 */
export interface AnswererSetting {
  /** The Employee the boss picked, or null for Automatic. */
  overrideId: string | null
  /** Who Automatic picks now: the first available Employee of the chain, ignoring the override. */
  automaticId: string | null
  /** Who answers the next unaddressed boss message, or null while nobody is available. */
  answererId: string | null
  /** Who an unanswered message waits for when nobody is available; null with no Employees. */
  waitingForId: string | null
  /** Why the boss's choice does not answer: `fired` they left, `unavailable` they cannot answer now. */
  stale: 'fired' | 'unavailable' | null
  /** Everyone the chain passed over, in chain order. */
  skipped: { employeeId: string; reason: Unavailability }[]
}
