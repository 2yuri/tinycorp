/**
 * The staff's slice of the IPC contract (T186). `src/shared/ipc/index.ts` composes the slices into
 * `TinyCorpApi`, so preload and the renderer keep importing one contract.
 *
 * What an Employee and a role *are* is `src/shared/domain/staff.ts`: the whole app names them, not
 * only this feature, so they stay in the vocabulary rather than move here.
 */

import type { Result } from '../domain/result'
import type {
  Employee,
  EmployeeInput,
  EmployeePatch,
  PermissionMode,
  RoleCreate,
  RoleDeletion,
  RoleTemplate,
  RoleTemplateInput,
} from '../domain/staff'

/** The current Company's role catalog and Employees. Exposed as `window.tinyCorp.staff`. */
export interface StaffApi {
  roles(): Promise<Result<RoleTemplate[]>>
  createRole(input: RoleCreate): Promise<Result<RoleTemplate>>
  updateRole(id: string, patch: Partial<RoleTemplateInput>): Promise<Result<RoleTemplate>>
  /**
   * Deletes a role, built-in or not (T240). A role Employees hold is refused, naming who holds it,
   * unless `reassignTo` says which role they move to first.
   */
  deleteRole(id: string, options?: RoleDeletion): Promise<Result<void>>
  /** Deletes every built-in role nobody was ever hired into. Answers the names it removed. */
  removeUnusedRoles(): Promise<Result<string[]>>
  employees(): Promise<Result<Employee[]>>
  hire(input: EmployeeInput): Promise<Result<Employee>>
  updateEmployee(id: string, patch: EmployeePatch): Promise<Result<Employee>>
  /** The permission mode a hire takes when none is named — the Company's default (T164). */
  permissionDefault(): Promise<Result<PermissionMode>>
  /** Sets it. Employees already on staff keep the mode they have. */
  setPermissionDefault(mode: PermissionMode): Promise<Result<PermissionMode>>
  /** Fires whenever roles or Employees change, including on Company switch. */
  onChanged(listener: () => void): () => void
}
