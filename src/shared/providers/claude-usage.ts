import type { BudgetExhausted } from '../capacity'

/**
 * What one open Company spends of the subscription: the Sessions it runs against its own cap,
 * and who waits for a slot.
 */
export interface CompanyUsage {
  companyId: string
  companyName: string
  /** At most this many Sessions of the Company run at once. */
  concurrencyCap: number
  /** Sessions of the Company running now. */
  running: number
  /** Names of Employees waiting for a slot, longest-waiting first. */
  parked: string[]
}

/**
 * What the boss's open Companies spend of the one subscription: the subscription is one per boss,
 * so this counts every open Company, not the current one — and the budget is the app-wide one.
 */
export interface ClaudeUsage {
  companies: CompanyUsage[]
  budget: BudgetExhausted | null
}
