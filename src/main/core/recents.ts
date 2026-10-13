import type { Company } from '../../shared/company'

/** Companies opened before, remembered across app restarts. Not domain state. */
export interface RecentCompanies {
  list(): Company[]
  remember(company: Company): void
  /** Drops a Company from the list; unknown ids are ignored. */
  forget(id: string): void
}
