/**
 * What the menu-bar item says while the window is closed (T117).
 *
 * The Company keeps working with no window, so the menu bar has to say the same things the office
 * header says of the floor it is standing in for: how many Employees are at work, how many are
 * waiting on the boss, and whether the subscription limit is hit. It is a pure projection of engine
 * facts, exactly like the header's own, so the two cannot drift apart.
 */
import { countAtWork, countWaitingOnYou } from '../office/at-work'
import type { SessionStatus } from '../session'

/** A Company the boss can reopen from the menu bar. */
export interface TrayCompany {
  id: string
  name: string
  /** The one the app opens to; its facts are the ones the item counts. */
  current: boolean
}

/** Engine facts the menu-bar item reads, all of the open Company, as the office header reads them. */
export interface TrayFacts {
  /** Session status by Employee id; whoever is missing has no Session. */
  sessions: Record<string, SessionStatus>
  /** Employees with an Approval the boss has not decided. */
  pendingRequesterIds: string[]
  /** Employees whose Session stopped in its terminal to ask the boss (T165). */
  askingIds: string[]
  /** The subscription limit is hit: every Session waits for the reset (decision 35). */
  outOfBudget: boolean
  /** The boss paused the Company: the item offers `Resume all` (decision 38). */
  paused: boolean
  /** Every Company the boss can reopen, the current one first. */
  companies: TrayCompany[]
}

export interface TraySummary {
  /** The open Company's name, or null when none is open. */
  company: string | null
  /** Employees whose Session is on and getting prompts — the header's `N at work`. */
  atWork: number
  /** Employees waiting on the boss — an Approval, or a Session stopped to ask — the office's `!`. */
  waitingOnYou: number
  outOfBudget: boolean
  paused: boolean
  /** Whether there is a Session to stop, which is when the header enables `Pause all`. */
  canPause: boolean
  companies: TrayCompany[]
}

/** The menu-bar item's own reading of the engine. */
export function traySummary(facts: TrayFacts): TraySummary {
  const atWork = countAtWork(facts.sessions)
  return {
    company: facts.companies.find((company) => company.current)?.name ?? null,
    atWork,
    waitingOnYou: countWaitingOnYou(facts.sessions, [...facts.pendingRequesterIds, ...facts.askingIds]),
    outOfBudget: facts.outOfBudget,
    paused: facts.paused,
    canPause: Object.values(facts.sessions).some((status) => status !== 'off'),
    companies: facts.companies,
  }
}

/** No Company open: the item still has to say what it is. */
export const NOTHING_OPEN = 'No Company open'

/**
 * What the item says of itself, in the header's own words: `3 at work · 2 waiting on you`, or
 * `Out of budget` when the limit is hit, which is the badge the header wears instead of the count.
 */
export function traySummaryLabel(summary: TraySummary): string {
  if (!summary.company) return NOTHING_OPEN
  const parts = [summary.outOfBudget ? 'Out of budget' : `${summary.atWork} at work`]
  if (summary.waitingOnYou > 0) parts.push(`${summary.waitingOnYou} waiting on you`)
  return parts.join(' · ')
}

/** The tooltip on the item: the floor it is standing in for, then what it says. */
export function trayTooltip(summary: TraySummary): string {
  return summary.company ? `${summary.company} · ${traySummaryLabel(summary)}` : traySummaryLabel(summary)
}
