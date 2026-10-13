import type { Routing } from './capability-routing'
import type { RoleCatalog, Staff } from './staff'

/** The Employees view's face on the engine (T188). */
export interface StaffFacade {
  /** The current Company's role catalog. */
  roles: RoleCatalog
  /** The current Company's Employees. */
  employees: Staff
  /** Who the current Company routes targets, PRs and hires to, by capability. */
  routing: Routing
}
