import type { CurrentCompany } from '../company'
import type { CapacityFacade } from '../sessions'
import type { StaffFacade } from '../staff'
import type { ProviderAccounts } from './provider-accounts'
import type { UsageLimits } from './usage-limits'
import type { UsageRoutingStore } from './usage-routing'

/**
 * The Usage popover and the routing settings, as they see the engine (T173, T188).
 *
 * Wider than one feature because the question it answers is: *which subscription is this Employee
 * on right now, and what happens when it runs out* — which needs the staff, the seats and the
 * accounts at once.
 */
export interface UsageFacade extends CurrentCompany, CapacityFacade, Pick<StaffFacade, 'employees'> {
  /** The boss's sign-ins per Provider, shared by every Company (T173). */
  accounts: ProviderAccounts
  /** What the app does about a Provider that ran out: the resume, the routing and the move back. */
  limits: UsageLimits
  /** The current Company's "when a provider runs out" rules and the Employees that override them. */
  usageRouting: UsageRoutingStore
}
