import { staffChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type {
  EmployeeInput,
  EmployeePatch,
  PermissionMode,
  RoleDeletion,
  RoleTemplateInput,
} from '../../../shared/domain/staff'
import type { IpcHandlerRegistry } from '../../core'
import type { StaffFacade } from './facade'

export interface StaffIpcOptions {
  ipc: IpcHandlerRegistry
  engine: StaffFacade
  broadcastChanged(): void
}

/**
 * Exposes the role catalog and Employees to the renderer. Holds no state of its own.
 * Only picks the fields the renderer may set; the engine validates their values.
 */
export function registerStaffIpc({ ipc, engine, broadcastChanged }: StaffIpcOptions): void {
  engine.employees.onChange(broadcastChanged)

  ipc.handle(staffChannels.roles, () => attempt(() => engine.roles.list()))
  ipc.handle(staffChannels.employees, () => attempt(() => engine.employees.list()))

  ipc.handle(staffChannels.createRole, (_event, input) =>
    attempt(() => {
      const fields = roleFields(input)
      const { templateId } = record(input)
      return engine.roles.create({
        name: requireString(fields.name, 'role name'),
        persona: requireString(fields.persona ?? '', 'persona', { allowEmpty: true }),
        capabilities: requireArray(fields.capabilities, 'capabilities'),
        repoFilter: requireArray(fields.repoFilter, 'repo filter'),
        areas: fields.areas ?? [],
        mcpServers: fields.mcpServers ?? [],
        skills: fields.skills ?? [],
        // The built-in the boss picked in the New role dialog, so the role keeps its word for an id
        // (T240); the engine refuses nothing here — an id it does not ship simply names no template.
        ...defined({ templateId: optionalString(templateId, 'template id') }),
      })
    }),
  )

  ipc.handle(staffChannels.updateRole, (_event, id, patch) =>
    attempt(() => engine.roles.update(requireString(id, 'role id'), roleFields(patch))),
  )

  ipc.handle(staffChannels.deleteRole, (_event, id, options) =>
    attempt(() => engine.roles.delete(requireString(id, 'role id'), roleDeletion(options))),
  )

  ipc.handle(staffChannels.removeUnusedRoles, () => attempt(() => engine.roles.removeUnused()))

  ipc.handle(staffChannels.hire, (_event, input) =>
    attempt(() => {
      const fields = employeeFields(input)
      const { roleId } = record(input)
      const hire: EmployeeInput = {
        ...fields,
        name: requireString(fields.name, 'Employee name'),
        roleId: requireString(roleId, 'role id'),
      }
      return engine.employees.create(hire)
    }),
  )

  ipc.handle(staffChannels.updateEmployee, (_event, id, patch) =>
    attempt(() => engine.employees.update(requireString(id, 'Employee id'), employeeFields(patch))),
  )

  ipc.handle(staffChannels.permissionDefault, () => attempt(() => engine.employees.permissionDefault()))

  ipc.handle(staffChannels.setPermissionDefault, (_event, mode) =>
    attempt(() => engine.employees.setPermissionDefault(requireString(mode, 'permission mode') as PermissionMode)),
  )
}

function roleFields(input: unknown): Partial<RoleTemplateInput> {
  const { name, persona, capabilities, repoFilter, areas, mcpServers, skills } = record(input)
  return defined({
    name: optionalString(name, 'role name'),
    persona: optionalString(persona, 'persona'),
    capabilities: optionalArray(capabilities, 'capabilities'),
    repoFilter: optionalArray(repoFilter, 'repo filter'),
    areas: optionalArray(areas, 'areas'),
    mcpServers: optionalArray(mcpServers, 'MCP servers'),
    skills: optionalArray(skills, 'skills'),
  })
}

function roleDeletion(input: unknown): RoleDeletion {
  if (input === undefined || input === null) return {}
  const { reassignTo } = record(input)
  return defined({ reassignTo: optionalString(reassignTo, 'role to move them to') })
}

function employeeFields(input: unknown): EmployeePatch {
  const {
    name,
    roleId,
    persona,
    capabilities,
    repoFilter,
    areas,
    mcpServers,
    skills,
    provider,
    permissionMode,
    model,
    sprite,
    followRole,
  } = record(input)
  return defined({
    name: optionalString(name, 'Employee name'),
    // Editing may move an Employee to another role; the engine refuses one the catalog does not
    // hold, and decides which fields follow it (T138).
    roleId: optionalString(roleId, 'role id'),
    persona: optionalString(persona, 'persona'),
    capabilities: optionalArray(capabilities, 'capabilities'),
    repoFilter: optionalArray(repoFilter, 'repo filter'),
    // The paths inside a repo this Employee works in (T239); `[]` is all of them.
    areas: optionalArray(areas, 'areas'),
    // Ids into the Company's own catalogue; the engine refuses one it does not hold (T136).
    mcpServers: optionalArray(mcpServers, 'MCP servers'),
    // Ids into the Company's own skill catalogue, the same way (T137).
    skills: optionalArray(skills, 'skills'),
    provider: optionalString(provider, 'provider') as EmployeePatch['provider'],
    permissionMode: optionalString(permissionMode, 'permission mode') as EmployeePatch['permissionMode'],
    model: model === null ? null : optionalString(model, 'model'),
    // Hiring and editing both carry a character; the engine says which indexes are sheets.
    sprite: optionalNumber(sprite, 'character'),
    followRole: optionalArray(followRole, 'fields to follow'),
  })
}

function attempt<T>(action: () => T): Result<T> {
  try {
    return { ok: true, value: action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object')
  }
  return value as Record<string, unknown>
}

/**
 * The fields the renderer actually sent. A field it left out is a field the patch says nothing
 * about, so the key goes rather than carrying `undefined` — which `exactOptionalPropertyTypes`
 * keeps apart from an absent key, and which the engine would have to guess at (T191).
 */
type Present<T> = { [K in keyof T]?: Exclude<T[K], undefined> }

function defined<T extends object>(fields: T): Present<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Present<T>
}

function requireString(value: unknown, what: string, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string' || (!allowEmpty && value === '')) throw new Error(`Missing ${what}`)
  return value
}

function optionalString(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : requireString(value, what, { allowEmpty: true })
}

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing ${what}`)
  return value
}

function optionalNumber(value: unknown, what: string): number | undefined {
  return value === undefined ? undefined : requireNumber(value, what)
}

function requireArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`Missing ${what}`)
  return value as T[]
}

function optionalArray<T>(value: unknown, what: string): T[] | undefined {
  return value === undefined ? undefined : requireArray<T>(value, what)
}
