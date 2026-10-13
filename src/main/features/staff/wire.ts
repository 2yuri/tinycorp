import type { CompanyContext, OpenCompany } from '../../core'
import { createRouting } from './capability-routing'
import type { StaffFacade } from './facade'
import { createStaff, type DefaultProvider, type RoleCatalog, type Staff } from './staff'

/** What the boss's app hands in, and a test leaves out. */
export interface StaffOptions {
  /**
   * The Provider a hire that names neither a Provider nor a model runs on (T169): the one this Mac
   * is ready for. Every Company's roster gets it, so a hire approved in a Company the boss is not
   * looking at lands on the same product as one made in front of them. Left out — as an engine
   * test leaves it — a hire lands on the catalogue's first.
   */
  defaultProvider?: DefaultProvider
}

export interface StaffDeps extends StaffOptions {}

/** One Company's roster: the role catalog and the Employees on it. */
export interface CompanyStaff {
  roles: RoleCatalog
  employees: Staff
}

/** The staff feature, once it is wired. */
export interface StaffFeature extends CompanyStaff {
  facade: StaffFacade
  /** Says the roster changed — a hire, a role edit, or the current Company itself. */
  notify(): void
  /** One open Company's own roster, whichever Company is current. */
  of(entry: OpenCompany): CompanyStaff
}

/**
 * Wires the role catalog and the Employees to the Companies the app has open (T187).
 *
 * Nothing is cached per Company: a roster is a handful of `SELECT`s over rows that another window,
 * an MCP call or a migration may have written a moment ago, so it is read each time rather than
 * held. What is held is the listener set of the *current* Company's roster, which is the one the
 * renderer follows.
 */
export function register(ctx: CompanyContext, deps: StaffDeps): StaffFeature {
  const current = createStaff(() => ctx.currentEntry().db, deps.defaultProvider)

  const routing = createRouting(() => current.employees.list())

  return {
    roles: current.roles,
    employees: current.employees,
    notify: current.notify,
    of: (entry) => createStaff(() => entry.db, deps.defaultProvider),
    facade: { roles: current.roles, employees: current.employees, routing },
  }
}
