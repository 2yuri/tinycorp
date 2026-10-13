import type { BossStatus } from './boss-profile'

/** A Company as the renderer and the engine's callers see it. */
export interface Company {
  id: string
  name: string
  /** 2–4 uppercase letters, unique among open Companies; ticket ids carry it (decision 33). */
  key: string
  /** The person running the Company, as the sidebar footer and every boss avatar show them. */
  boss: BossProfile
  /** Absolute path of the folder that holds the Company's SQLite file. */
  folder: string
  createdAt: string
  /** The Company's logo as a `data:` URL, read from its folder (T280); absent or null when it has none. */
  logo?: string | null
}

/**
 * How the boss appears inside a Company. One profile is shared by every Company (T79): the engine
 * fills these from `boss-profile.json` in userData. The fields beyond name and initials are
 * optional so a Company stored before T79 still reads.
 */
export interface BossProfile {
  name: string
  initials: string
  /** Mentions address the boss by this, stored without the `@`. */
  handle?: string
  /** The row of `characters.png` the boss's avatar draws, everywhere they appear. */
  sprite?: number
  /** Available / Focused / Away, as Your profile last left it. */
  status?: BossStatus
}

/** What Company settings can change. Absent fields stay as they are. */
export interface CompanyUpdate {
  name?: string
  key?: string
  bossName?: string
  /** Blank goes back to the initials of the boss's name. */
  bossInitials?: string
}

function recency(summary: CompanySummary): number {
  if (summary.current) return Number.POSITIVE_INFINITY
  if (summary.open) return Number.MAX_VALUE
  return summary.lastOpenedAt ? new Date(summary.lastOpenedAt).getTime() : Number.NEGATIVE_INFINITY
}

/**
 * The Launcher's order, which the menu's Open Recent follows too (#223): the Company in use, then
 * the open ones, then by last visit. One rule, so the two lists can never disagree about which
 * Company is the most recent.
 */
export function byRecency(summaries: CompanySummary[]): CompanySummary[] {
  return summaries
    .map((summary, index) => ({ summary, index, at: recency(summary) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map(({ summary }) => summary)
}

export const COMPANY_KEY_PATTERN = /^[A-Z]{2,4}$/

export const BOSS_INITIALS_PATTERN = /^[\p{L}\p{N}]{1,3}$/u

/** A default key from a Company name: the first letter of each word, `Test Co` → `TC`, `Acme` → `AC`. */
export function companyKeyFrom(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
  let key = words
    .map((w) => w[0])
    .join('')
    .slice(0, 4)
  if (key.length < 2) key = words.join('').slice(0, 2)
  return key.length >= 2 ? key : (key + 'CO').slice(0, 2)
}

/** Initials for a name: the first letters of the first two words, or the first two letters of one word. */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [...words[0]!].slice(0, 2).join('') : [...words[0]!][0]! + [...words[1]!][0]!
  return letters.toUpperCase()
}

/** A known Company as the Launcher lists it. */
export interface CompanySummary extends Company {
  /** Open in the engine: its Sessions may run even when another Company is current. */
  open: boolean
  current: boolean
  /** Employees on staff, or null when the Company's folder cannot be read. */
  employees: number | null
  /** Sessions of the Company running now; always 0 for a Company that is not open. */
  sessions: number
  /** When the Company was last open in the app, or null when never recorded. */
  lastOpenedAt: string | null
  /** When the setup wizard was finished or skipped; null while it has not been (decision 39). */
  onboardingCompletedAt: string | null
  /** The folder is no longer on disk: the Launcher shows the row as unavailable and never opens it (T57). */
  missing: boolean
  /**
   * The folder is there and names a database this PC does not hold — a Company in WSL last opened
   * on another PC, or one whose AppData has been wiped (T256). The row is unavailable for the same
   * reason `missing` makes one, and says something else.
   */
  databaseElsewhere: boolean
}

/**
 * What the Company rail marks on an open Company's tile (T145): how many Inbox rows wait on the boss,
 * and whether any of its Sessions is working. A Company that is not open has no entry at all.
 */
export interface CompanyAttention {
  companyId: string
  /** The Inbox's own unread count for that Company (see `bossInboxUnread`). */
  waiting: number
  /** A Session of that Company is busy: the office's `live` tone, not a count. */
  working: boolean
}
