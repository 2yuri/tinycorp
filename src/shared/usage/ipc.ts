import type { Result } from '../domain/result'
import type { ProviderAccount } from './provider-accounts'
import type { UsageSnapshot } from './provider-usage'
import type { EmployeeRouting, OutOfProviderRule, UsageRouting } from './usage-routing'

/**
 * What each Provider reports of the boss's subscription, for the drawer's Usage button and popover
 * (T80). The login behind the numbers stays in the main process. Exposed as `window.tinyCorp.usage`.
 */
export interface UsageApi {
  /** The last read while it is fresh, else a new one. */
  read(): Promise<Result<UsageSnapshot>>
  /** Asks every Provider again, however young the last read is. */
  refresh(): Promise<Result<UsageSnapshot>>
  /** Fires each time fresh numbers land. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/**
 * What a Company does when one Provider runs out, and the boss's sign-ins per Provider (T173,
 * frames `bB6VX` and `A2lOk0`). Exposed as `window.tinyCorp.routing`.
 *
 * Nothing here ever carries a credential: an account is a label and a config directory, and the
 * sign-in inside it is written by the product's own login, in the sign-in modal's terminal (T263).
 */
export interface RoutingApi {
  /** The Company's rules, its Employees' overrides and every account, in one read. */
  get(): Promise<Result<RoutingSettings>>
  setRule(provider: string, rule: OutOfProviderRule): Promise<Result<RoutingSettings>>
  setMoveBack(provider: string, on: boolean): Promise<Result<RoutingSettings>>
  setResumeAtReset(on: boolean): Promise<Result<RoutingSettings>>
  setRotateAccounts(on: boolean): Promise<Result<RoutingSettings>>
  /** Pins every Employee of this Company to one account; null is "the first one with room left". */
  setPinnedAccount(provider: string, accountId: string | null): Promise<Result<RoutingSettings>>
  /** One Employee's own rule, or null to follow the Company again. */
  setEmployeeRule(employeeId: string, rule: OutOfProviderRule | null): Promise<Result<RoutingSettings>>
  setEmployeePin(employeeId: string, provider: string, accountId: string | null): Promise<Result<RoutingSettings>>
  /** Adds a sign-in with its own config directory. It is not signed in until the sign-in modal runs (T263). */
  addAccount(provider: string, label: string): Promise<Result<RoutingSettings>>
  renameAccount(accountId: string, label: string): Promise<Result<RoutingSettings>>
  setDefaultAccount(accountId: string): Promise<Result<RoutingSettings>>
  removeAccount(accountId: string): Promise<Result<RoutingSettings>>
  /** `Continue on <P> now` from the out-of-budget card (frame `tdI8o`, c). */
  continueNow(employeeId: string): Promise<Result<void>>
  /** `Back to <P> now` from the drawer chip (frame `tdI8o`, a). */
  moveBackNow(employeeId: string): Promise<Result<void>>
  /** Fires after any of it changes, and on Company switch. */
  onChanged(listener: () => void): () => void
}

/** Everything the Usage & routing tab and the Accounts card draw, in one shape. */
export interface RoutingSettings {
  routing: UsageRouting
  /** Every Employee that does not follow the Company rule, in hire order. */
  overrides: { employeeId: string; name: string; routing: EmployeeRouting }[]
  /** Every account of every Provider, in catalogue order. */
  accounts: ProviderAccount[]
  /** The Providers whose CLI keeps one sign-in, so the card says so rather than offering more. */
  oneAccountProviders: string[]
}
