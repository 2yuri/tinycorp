import type { Company, CompanyAttention, CompanySummary, CompanyUpdate } from '../../../shared/company'
import type { BossProfiles } from './boss-profile'

/**
 * A Company, as the rest of the app sees one.
 *
 * These are the faces the engine puts on for this feature (T188): each screen's IPC module names
 * the one it uses rather than the whole engine, so adding a member to one feature cannot widen what
 * another can reach. `CompanyEngine` is the composition of all of them.
 */

/**
 * The Company changed — switched, renamed, opened or closed.
 *
 * Nearly every screen listens to this, because nearly every screen draws the current Company; it is
 * its own face so that listening for it costs no other access.
 */
export interface CompanyChanged {
  /** Called after the current Company changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/**
 * A feature's own half of its face: everything it puts on the engine except `onChange`.
 *
 * Nearly every facade extends `CompanyChanged`, and none of those features owns it — the Company
 * lifecycle does, and it is one listener set for the whole app. So a feature's `wire.ts` builds
 * `OwnFace<ItsFacade>` and the composition root puts the lifecycle's `onChange` beside it once.
 */
export type OwnFace<Facade> = Omit<Facade, keyof CompanyChanged>

/** Which Company the boss is looking at, and when that changes. */
export interface CurrentCompany extends CompanyChanged {
  currentCompany(): Company | null
}

/** The Launcher's and Company settings' own: making one, opening it, leaving it. */
export interface CompanyFacade extends CurrentCompany {
  createCompany(input: { folder: string; name?: string }): Company
  openCompany(folder: string): Company
  switchCompany(id: string): Company
  /** Company settings: renames the current Company, changes its key or the boss profile. */
  updateCompany(update: CompanyUpdate): Company
  /**
   * Remove from launcher: stops the Company's Sessions, closes it and drops it from the known
   * Companies. Its folder stays as it is, so opening the folder brings it back.
   */
  forgetCompany(id: string): void
  /**
   * Delete company: forgets the Company, then removes its own data from its folder (see
   * `COMPANY_DATA`). Connected repos and every other file in the folder stay.
   */
  deleteCompany(id: string): void
  /** Every Company known to this app: open now or opened before. */
  listCompanies(): Company[]
  /** Every known Company with its staff, running Sessions and last visit, for the Launcher. */
  companySummaries(): CompanySummary[]
  /**
   * What the Company rail marks on each open Company (T145): the Inbox's unread count and whether a
   * Session is working. A Company that is not open has no entry and is never read for one.
   */
  companyAttention(): CompanyAttention[]
  /** Called when an open Company's rail marks may have changed. Returns an unsubscribe function. */
  onAttentionChange(listener: () => void): () => void
}

/** Move… (decision 45), which is its own screen and its own risk. */
export interface CompanyMoveFacade {
  /**
   * Stops the Company's Sessions, moves its folder to `folder` (or into it, when it holds files),
   * updates recents and reopens it with its Sessions restarted. Returns it moved.
   */
  moveCompany(id: string, folder: string): Company
  listCompanies(): Company[]
  currentCompany(): Company | null
}

/** The boss's own profile, shared by every Company (T79). */
export interface BossFacade {
  boss: BossProfiles
}
