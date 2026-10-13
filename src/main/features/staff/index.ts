/**
 * The staff: the Company's role catalog, the Employees hired onto it, and who may do what.
 *
 * The feature's front door. An Employee and a role are `src/shared/domain/staff.ts`, because the
 * whole app names them; what is here is how a Company keeps them — the rows, the sprite handout,
 * the fields an Employee follows its role on, and the routing that answers "who plans?".
 */

export { createRouting, type Routing } from './capability-routing'
export type { StaffFacade } from './facade'
export { registerStaffIpc } from './ipc'
export { ROLE_FOLLOW_MIGRATION } from './role-follow'
export {
  EMPLOYEE_MODEL_MIGRATION,
  type EmployeeRow,
  freeDesk,
  type RoleCatalog,
  SECURITY_ROLE_MIGRATION,
  STAFF_AREAS_MIGRATION,
  type Staff,
  staffMigration,
  toEmployee,
} from './staff'
export { STAFF_DEFAULTS_MIGRATION } from './staff-defaults'
export { type CompanyStaff, register as registerStaff, type StaffFeature, type StaffOptions } from './wire'
