import { type BudgetExhausted, UNKNOWN_RESET_RETRY_MS } from '../../../shared/capacity'
import { clockTime } from '../../../shared/platform/clock-time'

export { clockTime }

/** "in 2h 12m", "in 12m", "in under a minute", or "any moment now" once it is due. */
export function countdown(at: Date, now: Date): string {
  const left = at.getTime() - now.getTime()
  if (left <= 0) return 'any moment now'
  const minutes = Math.ceil(left / 60_000)
  if (left < 60_000) return 'in under a minute'
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `in ${minutes}m`
  const days = Math.floor(hours / 24)
  if (days > 0) return `in ${days}d ${hours % 24}h`
  return `in ${hours}h ${minutes % 60}m`
}

/** When the team is back: the reset time, or the engine's retry time when the provider named none. */
export function backAt(budget: BudgetExhausted): { at: Date; known: boolean } {
  if (budget.resetsAt) return { at: new Date(budget.resetsAt), known: true }
  return { at: new Date(new Date(budget.exhaustedAt).getTime() + UNKNOWN_RESET_RETRY_MS), known: false }
}

/** The overlay's reset pill: "Resets at 14:00 · in 2h 12m". */
export function resetLine(budget: BudgetExhausted, now: Date): string {
  const { at, known } = backAt(budget)
  const when = `${clockTime(at, now)} · ${countdown(at, now)}`
  return known ? `Resets at ${when}` : `Reset time unknown · trying again at ${when}`
}

/**
 * The same pill once the Company resumes by itself (T173, frame `tdI8o` c): `Back at 21:00
 * automatically · in 2h 13m`. There is no button to press at 21:00 — the app scheduled the return
 * when the limit was hit.
 */
export function automaticResetLine(budget: BudgetExhausted, now: Date): string {
  const { at, known } = backAt(budget)
  if (!known) return `Reset time unknown · trying again at ${clockTime(at, now)} · ${countdown(at, now)}`
  return `Back at ${clockTime(at, now)} automatically · ${countdown(at, now)}`
}

/** The line under the card that says where the boss turns that off. */
export const AUTO_RESUME_NOTE = 'Resume automatically at reset is on in Company settings.'
