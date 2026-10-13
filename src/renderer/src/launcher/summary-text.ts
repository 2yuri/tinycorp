import type { CompanySummary } from '../../../shared/company'
import { DATABASE_ON_ANOTHER_PC } from '../../../shared/platform/company-folder'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** "now", "5m ago", "2h ago", "yesterday", "3 days ago", "last week", "3 weeks ago"… or null when never. */
export function relativeWhen(at: string | null, now: Date): string | null {
  if (!at) return null
  const elapsed = Math.max(0, now.getTime() - new Date(at).getTime())
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 60) return 'last month'
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  if (days < 730) return 'last year'
  return `${Math.floor(days / 365)} years ago`
}

/** What a row whose folder is gone says instead of its staff and last visit (T57). */
export const MISSING_META = 'Folder missing'

/** The same line for a Company in WSL whose database this PC does not hold (T256). */
export const ELSEWHERE_META = 'Database on another PC'

/** Whether a row has nothing to open: its folder is gone, or its database is (T57, T256). */
export function unavailable(summary: Pick<CompanySummary, 'missing' | 'databaseElsewhere'>): boolean {
  return summary.missing || summary.databaseElsewhere
}

/** The badge on a row whose setup wizard was never finished: opening it goes back to it (T59). */
export const SETUP_UNFINISHED = 'Setup unfinished'

/**
 * Whether a row wears the `Setup unfinished` badge. A Company whose folder is gone never opens, so
 * it is told what is wrong with it rather than what it still owes.
 */
export function setupUnfinished(
  summary: Pick<CompanySummary, 'onboardingCompletedAt' | 'missing' | 'databaseElsewhere'>,
): boolean {
  return !unavailable(summary) && summary.onboardingCompletedAt === null
}

/**
 * What the Launcher says instead of opening a Company it cannot, or null when there is nothing in
 * the way: ⌘N and ↵ reach every row, so the answer is a sentence, never a failed open.
 */
export function unavailableMessage(
  summary: Pick<CompanySummary, 'name' | 'folder' | 'missing' | 'databaseElsewhere'>,
): string | null {
  if (summary.missing) return `${summary.name} is no longer in ${summary.folder}`
  return summary.databaseElsewhere ? DATABASE_ON_ANOTHER_PC : null
}

/** A Launcher row's meta line: "8 employees · 5 sessions · now" or "3 employees · idle · yesterday". */
export function companyMeta(summary: CompanySummary, now: Date): string {
  // Counts read before the folder went are no longer true of anything the boss can open.
  if (summary.missing) return MISSING_META
  if (summary.databaseElsewhere) return ELSEWHERE_META
  return [
    summary.employees === null ? null : count(summary.employees, 'employee'),
    summary.sessions > 0 ? count(summary.sessions, 'session') : 'idle',
    summary.open ? 'now' : closedWhen(summary.lastOpenedAt, now),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** "now" belongs to open Companies; one closed moments ago was open "just now". */
function closedWhen(at: string | null, now: Date): string | null {
  const when = relativeWhen(at, now)
  return when === 'now' ? 'just now' : when
}
