import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { FALLBACK_PROVIDER, type Provider } from '../../../shared/domain/providers'
import {
  type Areas,
  CAPABILITIES,
  type Capability,
  type Employee,
  type EmployeeInput,
  type EmployeePatch,
  PERMISSION_MODES,
  type PermissionMode,
  PROVIDERS,
  type RepoFilter,
  type RoleCreate,
  type RoleDeletion,
  type RoleTemplate,
  type RoleTemplateInput,
  SECURITY_ROLE_ID,
} from '../../../shared/domain/staff'
import { CHARACTER_SHEETS, leastUsedSheet } from '../../../shared/office/characters'
import { providerForModel, requireModel } from '../../../shared/staff/models'
import { jobAfterRoleChange, overridesAfterEdit, overridesAtHire } from '../../../shared/staff/role-follow'
import { type RoleBlueprint, requireRoleTemplate, roleTemplate } from '../../../shared/staff/role-templates'
import type { Migration } from '../../core'
import { cleanGrants, cleanSkillGrants, parseGrants, parseSkillGrants } from '../catalogue'
import { parseOverrides, propagateRole, requireJobFields } from './role-follow'
import { defaultPermissionMode, setDefaultPermissionMode } from './staff-defaults'

/** Character sheets shipped with the office. Sprites are handed out least-used first. */
export const SPRITE_COUNT = CHARACTER_SHEETS

export interface RoleCatalog {
  list(): RoleTemplate[]
  /** From a built-in template (`templateId`), or from nothing. */
  create(input: RoleCreate): RoleTemplate
  /** Also rewrites the fields every Employee on the role has not overridden. */
  update(id: string, patch: Partial<RoleTemplateInput>): RoleTemplate
  /**
   * Deletes a role, a built-in as readily as a custom one (T240). Refuses one Employees hold —
   * former Employees included, because a rehire walks back onto it — naming who holds it, unless
   * `reassignTo` says which role they move to first.
   */
  delete(id: string, options?: RoleDeletion): void
  /**
   * Creates each of these built-in templates the Company does not hold yet, under the template's
   * own id, and answers the roles for those ids. How a Company comes to hold a role at all: the
   * setup wizard calls it for the roster it is about to hire, and a hire calls it for its own role.
   */
  ensure(templateIds: string[]): RoleTemplate[]
  /**
   * Deletes every built-in role nobody was ever hired into, and answers the names it removed. The
   * boss's one click on \"Remove unused roles\": a Company from before T240 was seeded with all
   * eight, and the ones it never used are swept only when it asks (T240).
   */
  removeUnused(): string[]
}

export interface Staff {
  list(): Employee[]
  create(input: EmployeeInput): Employee
  update(id: string, patch: EmployeePatch): Employee
  /**
   * The permission mode a hire takes when none is named: the Company's own default (T164). Every
   * way in reaches it — the hire form, HR's hiring tools and the setup wizard all leave the field
   * out, so none of them has to know what the default is.
   */
  permissionDefault(): PermissionMode
  /** Sets it. Everyone already on staff keeps the mode they have. */
  setPermissionDefault(mode: PermissionMode): PermissionMode
  /** Called after roles or Employees change, or the current Company does. */
  onChange(listener: () => void): () => void
}

/** The database of the current Company; throws when none is open. */
export type CurrentDatabase = () => DatabaseSync

/**
 * The Provider a hire that names neither a Provider nor a model runs on (T169): the one this Mac is
 * ready for, read from the preflight answers the app already holds. Every way in reaches it —
 * HR's `hire_request` leaves the model out, and the setup wizard can too — so no caller has to know
 * which products exist. Without one, the catalogue's first, which is what an engine test gets.
 */
export type DefaultProvider = () => Provider

export function createStaff(
  currentDb: CurrentDatabase,
  defaultProvider: DefaultProvider = () => FALLBACK_PROVIDER,
): {
  roles: RoleCatalog
  employees: Staff
  notify(): void
} {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const roles: RoleCatalog = {
    list() {
      const rows = currentDb()
        .prepare('SELECT * FROM role_template ORDER BY position, rowid')
        .all() as unknown as RoleRow[]
      return rows.map(toRole)
    },

    create(input) {
      const db = currentDb()
      const template: RoleTemplate = {
        id: roleIdFor(db, input.templateId),
        name: requireName(input.name, 'role'),
        persona: requireText(input.persona, 'persona'),
        capabilities: requireCapabilities(input.capabilities),
        repoFilter: cleanRepoFilter(input.repoFilter),
        areas: cleanAreas(input.areas ?? []),
        mcpServers: cleanGrants(db, input.mcpServers ?? []),
        skills: cleanSkillGrants(db, input.skills ?? []),
        seeded: input.templateId !== undefined && roleTemplate(input.templateId) !== null,
      }
      ensureUniqueName(db, 'role_template', template.name, 'A role')
      const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM role_template').get() as {
        next: number
      }
      db.prepare(
        `INSERT INTO role_template (id, name, persona, capabilities, repo_filter, areas, mcp_servers, skills,
           seeded, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        template.id,
        template.name,
        template.persona,
        JSON.stringify(template.capabilities),
        JSON.stringify(template.repoFilter),
        JSON.stringify(template.areas),
        JSON.stringify(template.mcpServers),
        JSON.stringify(template.skills),
        template.seeded ? 1 : 0,
        next,
      )
      notify()
      return template
    },

    update(id, patch) {
      const db = currentDb()
      const current = findRole(db, id)
      const next: RoleTemplate = {
        ...current,
        ...(patch.name !== undefined && { name: requireName(patch.name, 'role') }),
        ...(patch.persona !== undefined && { persona: requireText(patch.persona, 'persona') }),
        ...(patch.capabilities !== undefined && {
          capabilities: requireCapabilities(patch.capabilities),
        }),
        ...(patch.repoFilter !== undefined && { repoFilter: cleanRepoFilter(patch.repoFilter) }),
        ...(patch.areas !== undefined && { areas: cleanAreas(patch.areas) }),
        ...(patch.mcpServers !== undefined && { mcpServers: cleanGrants(db, patch.mcpServers) }),
        ...(patch.skills !== undefined && { skills: cleanSkillGrants(db, patch.skills) }),
      }
      ensureUniqueName(db, 'role_template', next.name, 'A role', id)
      db.prepare(
        `UPDATE role_template SET name = ?, persona = ?, capabilities = ?, repo_filter = ?, areas = ?,
           mcp_servers = ?, skills = ? WHERE id = ?`,
      ).run(
        next.name,
        next.persona,
        JSON.stringify(next.capabilities),
        JSON.stringify(next.repoFilter),
        JSON.stringify(next.areas),
        JSON.stringify(next.mcpServers),
        JSON.stringify(next.skills),
        id,
      )
      propagateRole(db, next)
      notify()
      return next
    },

    delete(id, options = {}) {
      const db = currentDb()
      const role = findRole(db, id)
      const { reassignTo } = options
      if (reassignTo !== undefined) {
        if (reassignTo === id) throw new Error(`Pick a role other than ${role.name} to move them to`)
        // Through the Employee's own edit, so everyone lands on the new role by the rules a role
        // change always follows (T138): what they overrode stays theirs, what they followed moves.
        for (const holder of holdersOf(db, id)) employees.update(holder.id, { roleId: reassignTo })
      }
      const held = holdersOf(db, id)
      if (held.length > 0) throw new Error(deleteRefusal(role, held))
      db.prepare('DELETE FROM role_template WHERE id = ?').run(id)
      notify()
    },

    ensure(templateIds) {
      const db = currentDb()
      const before = countRoles(db)
      const made = ensureRoles(db, templateIds)
      if (countRoles(db) !== before) notify()
      return made
    },

    removeUnused() {
      const db = currentDb()
      const removed: string[] = []
      for (const role of roles.list()) {
        if (!role.seeded || holdersOf(db, role.id).length > 0) continue
        db.prepare('DELETE FROM role_template WHERE id = ?').run(role.id)
        removed.push(role.name)
      }
      if (removed.length > 0) notify()
      return removed
    },
  }

  const employees: Staff = {
    list() {
      const rows = currentDb()
        .prepare('SELECT * FROM employee WHERE fired_at IS NULL ORDER BY created_at, rowid')
        .all() as unknown as EmployeeRow[]
      return rows.map(toEmployee)
    },

    create(input) {
      const db = currentDb()
      // A Company holds the roles of the Employees it has (T240): hiring into a built-in it does
      // not hold yet creates that one role, and nothing else. This is what makes the setup wizard
      // seed four roles rather than eight. The hire's own `notify` covers the role too.
      ensureRoles(db, [input.roleId])
      const role = findRole(db, input.roleId)
      const name = requireName(input.name, 'Employee')
      ensureUniqueName(db, 'employee', name, 'An Employee')
      // A model id belongs to one entry of the catalogue, so a hire that names a model names the
      // product that runs it (T139): nothing has to be told the Provider twice, and nothing can
      // arrive pointing at a model its Provider does not have.
      const provider = requireOneOf(
        input.provider ?? providerForModel(input.model ?? null) ?? defaultProvider(),
        PROVIDERS,
        'provider',
      )
      const job = {
        persona: requireText(input.persona ?? role.persona, 'persona'),
        capabilities: requireCapabilities(input.capabilities ?? role.capabilities),
        repoFilter: cleanRepoFilter(input.repoFilter ?? role.repoFilter),
        areas: cleanAreas(input.areas ?? role.areas),
        mcpServers: cleanGrants(db, input.mcpServers ?? role.mcpServers),
        skills: cleanSkillGrants(db, input.skills ?? role.skills),
      }
      const employee: Employee = {
        id: randomUUID(),
        name,
        roleId: role.id,
        title: role.name,
        ...job,
        provider,
        permissionMode: requireOneOf(
          input.permissionMode ?? defaultPermissionMode(db),
          PERMISSION_MODES,
          'permission mode',
        ),
        model: requireModel(provider, input.model ?? null),
        overrides: overridesAtHire(role, job),
        desk: freeDesk(db),
        sprite: input.sprite === undefined ? leastUsedSprite(db) : requireSprite(input.sprite),
        createdAt: new Date().toISOString(),
      }
      db.prepare(
        `INSERT INTO employee (id, name, role_id, title, persona, capabilities, repo_filter, areas, mcp_servers,
           skills, provider, permission_mode, model, overrides, desk, sprite, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        employee.id,
        employee.name,
        employee.roleId,
        employee.title,
        employee.persona,
        JSON.stringify(employee.capabilities),
        JSON.stringify(employee.repoFilter),
        JSON.stringify(employee.areas),
        JSON.stringify(employee.mcpServers),
        JSON.stringify(employee.skills),
        employee.provider,
        employee.permissionMode,
        employee.model,
        JSON.stringify(employee.overrides),
        employee.desk,
        employee.sprite,
        employee.createdAt,
      )
      notify()
      return employee
    },

    update(id, patch) {
      const db = currentDb()
      const row = db.prepare('SELECT * FROM employee WHERE id = ?').get(id) as EmployeeRow | undefined
      if (!row) throw new Error(`Unknown Employee: ${id}`)
      const before = toEmployee(row)
      // A role change is not a re-hire (T138): the Employee keeps its desk, character, Sessions and
      // tickets, and only the job fields it was following move onto the new role. The fields the
      // patch carries win over them, so the form's preview is what lands.
      // Moving onto a built-in the Company has not taken yet takes it, the way hiring does (T240).
      if (patch.roleId !== undefined) ensureRoles(db, [patch.roleId])
      const role = findRole(db, patch.roleId ?? before.roleId)
      const moved = role.id === before.roleId ? {} : jobAfterRoleChange(role, before)
      const followRole = requireJobFields(patch.followRole ?? [])
      const edited: Employee = {
        ...before,
        ...moved,
        roleId: role.id,
        title: role.name,
        ...(patch.name !== undefined && { name: requireName(patch.name, 'Employee') }),
        ...(patch.persona !== undefined && { persona: requireText(patch.persona, 'persona') }),
        ...(patch.capabilities !== undefined && {
          capabilities: requireCapabilities(patch.capabilities),
        }),
        ...(patch.repoFilter !== undefined && { repoFilter: cleanRepoFilter(patch.repoFilter) }),
        ...(patch.areas !== undefined && { areas: cleanAreas(patch.areas) }),
        ...(patch.mcpServers !== undefined && { mcpServers: cleanGrants(db, patch.mcpServers) }),
        ...(patch.skills !== undefined && { skills: cleanSkillGrants(db, patch.skills) }),
        ...(patch.provider !== undefined && {
          provider: requireOneOf(patch.provider, PROVIDERS, 'provider'),
        }),
        ...(patch.permissionMode !== undefined && {
          permissionMode: requireOneOf(patch.permissionMode, PERMISSION_MODES, 'permission mode'),
        }),
        // The boss's choice, not the hand-out's: two Employees on one character is allowed.
        ...(patch.sprite !== undefined && { sprite: requireSprite(patch.sprite) }),
      }
      const model = patch.model !== undefined ? patch.model : edited.model
      // Moving an Employee to a model moves them to the product that owns it, unless the caller
      // said which Provider it means — in which case a model from another one is a mistake, and
      // `requireModel` says so rather than quietly rewriting either half (T139).
      const provider = patch.provider !== undefined ? edited.provider : (providerForModel(model) ?? edited.provider)
      const next: Employee = {
        ...edited,
        ...Object.fromEntries(followRole.map((field) => [field, role[field]])),
        provider,
        model: requireModel(provider, model),
        overrides: overridesAfterEdit({ role, before, after: edited, followRole }),
      }
      ensureUniqueName(db, 'employee', next.name, 'An Employee', id)
      db.prepare(
        `UPDATE employee SET name = ?, role_id = ?, title = ?, persona = ?, capabilities = ?, repo_filter = ?,
           areas = ?, mcp_servers = ?, skills = ?, provider = ?, permission_mode = ?, model = ?, overrides = ?,
           sprite = ? WHERE id = ?`,
      ).run(
        next.name,
        next.roleId,
        next.title,
        next.persona,
        JSON.stringify(next.capabilities),
        JSON.stringify(next.repoFilter),
        JSON.stringify(next.areas),
        JSON.stringify(next.mcpServers),
        JSON.stringify(next.skills),
        next.provider,
        next.permissionMode,
        next.model,
        JSON.stringify(next.overrides),
        next.sprite,
        id,
      )
      notify()
      return next
    },

    permissionDefault: () => defaultPermissionMode(currentDb()),

    setPermissionDefault(mode) {
      const set = setDefaultPermissionMode(currentDb(), mode)
      notify()
      return set
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return { roles, employees, notify }
}

/**
 * The Security role for the Companies that existed before it did (T241), and only those.
 *
 * A Company being created runs its migrations before its own row is inserted, so `EXISTS (SELECT 1
 * FROM company)` is what tells an old database from a new one — the same trick the onboarding
 * migrations use. A Company that already ran this step keeps the row it was given; one created
 * since T240 holds the roles it uses and takes Security from the catalogue like any other
 * built-in, from New role or from the first Security it hires.
 */
const SECURITY_ROLE = requireRoleTemplate(SECURITY_ROLE_ID)

export const SECURITY_ROLE_MIGRATION: Migration = {
  name: 'staff-security-role',
  sql: `
  INSERT OR IGNORE INTO role_template (id, name, persona, capabilities, repo_filter, seeded, position)
  SELECT ${sql(SECURITY_ROLE.id)}, ${sql(SECURITY_ROLE.name)}, ${sql(SECURITY_ROLE.persona)},
         ${sql(JSON.stringify(SECURITY_ROLE.capabilities))}, ${sql(JSON.stringify(SECURITY_ROLE.repoFilter))}, 1,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM role_template)
   WHERE EXISTS (SELECT 1 FROM company);
`,
}

/**
 * Schema for roles and Employees. One migration step.
 *
 * It used to seed all the built-in roles into every new Company. It does not any more (T240): the
 * built-ins are a catalogue (`shared/staff/role-templates.ts`) and a Company holds the roles of the
 * Employees it hired. The step keeps its name and its tables, so a Company that already ran it
 * keeps the rows it was given — nothing is deleted behind the boss's back, and the Roles list marks
 * the ones nobody uses with a "Remove unused roles" they can press.
 */
export const staffMigration: Migration = {
  name: 'staff-tables',
  sql: `
  CREATE TABLE role_template (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    persona TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    repo_filter TEXT NOT NULL,
    seeded INTEGER NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE employee (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES role_template (id),
    title TEXT NOT NULL,
    persona TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    repo_filter TEXT NOT NULL,
    provider TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    desk INTEGER NOT NULL UNIQUE,
    sprite INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`,
}

/** `Employee.model` (decision 31): null runs on the provider's default. Also on hire proposals. */
export const EMPLOYEE_MODEL_MIGRATION: Migration = {
  name: 'staff-employee-model',
  sql: `
  ALTER TABLE employee ADD COLUMN model TEXT;
  ALTER TABLE staffing_request ADD COLUMN model TEXT;
`,
}

/** What the two templates shipped with, and the only value the migration below replaces. */
const SHIPPED_FRONTEND_FILTER = ['*front*', '*web*', '*ui*', '*app*', '*client*']
const SHIPPED_BACKEND_FILTER = ['*back*', '*api*', '*server*', '*service*', '*worker*']

/**
 * Areas (T239): the paths inside a repo a role or an Employee works in. Null is every path of every
 * repo it may work in, which is what everyone had before this.
 *
 * It also repairs the two seeded templates that shipped a glob over the repo *name* — Frontend
 * `*front* *web* *ui* *app* *client*`, Backend `*back* *api* *server* *service* *worker*`. A
 * monorepo matches neither, so a Company dogfooding one funnelled every ticket to the Tech Lead. It
 * is repaired only where it is still word for word what shipped: a filter the boss wrote is the
 * boss's, and an Employee already hired is never changed here — Edit Employee offers them the
 * one-click "Allow all repos" instead.
 */
export const STAFF_AREAS_MIGRATION: Migration = {
  name: 'staff-areas',
  sql: `
  ALTER TABLE role_template ADD COLUMN areas TEXT;
  ALTER TABLE employee ADD COLUMN areas TEXT;
  UPDATE role_template SET repo_filter = '["*"]'
   WHERE seeded = 1 AND (
     (id = 'frontend' AND repo_filter = ${sql(JSON.stringify(SHIPPED_FRONTEND_FILTER))}) OR
     (id = 'backend' AND repo_filter = ${sql(JSON.stringify(SHIPPED_BACKEND_FILTER))})
   );
`,
}

interface RoleRow {
  id: string
  name: string
  persona: string
  capabilities: string
  repo_filter: string
  areas: string | null
  mcp_servers: string | null
  skills: string | null
  seeded: number
}

export interface EmployeeRow {
  id: string
  name: string
  role_id: string
  title: string
  persona: string
  capabilities: string
  repo_filter: string
  areas: string | null
  mcp_servers: string | null
  skills: string | null
  provider: string
  permission_mode: string
  model: string | null
  overrides: string
  desk: number
  sprite: number
  created_at: string
}

function toRole(row: RoleRow): RoleTemplate {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    capabilities: JSON.parse(row.capabilities) as Capability[],
    repoFilter: JSON.parse(row.repo_filter) as RepoFilter,
    areas: parseAreas(row.areas),
    mcpServers: parseGrants(row.mcp_servers),
    skills: parseSkillGrants(row.skills),
    seeded: row.seeded === 1,
  }
}

export function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    roleId: row.role_id,
    title: row.title,
    persona: row.persona,
    capabilities: JSON.parse(row.capabilities) as Capability[],
    repoFilter: JSON.parse(row.repo_filter) as RepoFilter,
    areas: parseAreas(row.areas),
    mcpServers: parseGrants(row.mcp_servers),
    skills: parseSkillGrants(row.skills),
    provider: row.provider as Employee['provider'],
    permissionMode: row.permission_mode as Employee['permissionMode'],
    model: row.model ?? null,
    overrides: parseOverrides(row.overrides),
    desk: row.desk,
    sprite: row.sprite,
    createdAt: row.created_at,
  }
}

function findRole(db: DatabaseSync, id: string): RoleTemplate {
  const row = db.prepare('SELECT * FROM role_template WHERE id = ?').get(id) as RoleRow | undefined
  if (!row) throw new Error(`Unknown role: ${id}`)
  return toRole(row)
}

export function freeDesk(db: DatabaseSync): number {
  const taken = new Set((db.prepare('SELECT desk FROM employee').all() as { desk: number }[]).map((r) => r.desk))
  let desk = 0
  while (taken.has(desk)) desk++
  return desk
}

/** A character the boss picked, hiring or editing: an index into the sheets of `characters.png`. */
function requireSprite(sprite: unknown): number {
  if (typeof sprite !== 'number' || !Number.isInteger(sprite) || sprite < 0 || sprite >= SPRITE_COUNT) {
    throw new Error(`A character is one of 0 to ${SPRITE_COUNT - 1}`)
  }
  return sprite
}

function leastUsedSprite(db: DatabaseSync): number {
  const rows = db.prepare('SELECT sprite FROM employee WHERE fired_at IS NULL').all() as { sprite: number }[]
  return leastUsedSheet(rows.map((row) => row.sprite))
}

function ensureUniqueName(
  db: DatabaseSync,
  table: 'role_template' | 'employee',
  name: string,
  what: string,
  exceptId = '',
): void {
  const clash = db.prepare(`SELECT 1 FROM ${table} WHERE lower(name) = lower(?) AND id != ?`).get(name, exceptId)
  if (clash) throw new Error(`${what} named ${name} already exists`)
}

function requireName(name: unknown, what: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error(`A ${what} needs a name`)
  return trimmed
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`A ${what} must be text`)
  return value
}

function requireCapabilities(capabilities: unknown): Capability[] {
  if (!Array.isArray(capabilities)) throw new Error('Capabilities must be a list')
  for (const capability of capabilities) {
    if (!CAPABILITIES.includes(capability as Capability)) {
      throw new Error(`Unknown capability: ${String(capability)}`)
    }
  }
  return [...new Set(capabilities as Capability[])]
}

function cleanRepoFilter(filter: unknown): RepoFilter {
  if (!Array.isArray(filter) || filter.some((p) => typeof p !== 'string')) {
    throw new Error('A repo filter must be a list of patterns')
  }
  return (filter as string[]).map((p) => p.trim()).filter(Boolean)
}

/** The paths a role or Employee works in, as written, without the duplicates and the blanks. */
function cleanAreas(areas: unknown): Areas {
  if (!Array.isArray(areas) || areas.some((a) => typeof a !== 'string')) {
    throw new Error('Areas must be a list of paths')
  }
  return [...new Set((areas as string[]).map((a) => a.trim()).filter(Boolean))]
}

/** A database written before areas existed has none: every repo it may work in, whole. */
function parseAreas(text: string | null): Areas {
  if (text === null) return []
  const parsed = JSON.parse(text) as unknown
  return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : []
}

function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value as T)) throw new Error(`Unknown ${what}: ${String(value)}`)
  return value as T
}

/**
 * Creates each of these built-in templates the Company does not hold yet, and answers the roles
 * for those ids. Tells nobody: every caller is in the middle of something that notifies for it.
 */
function ensureRoles(db: DatabaseSync, templateIds: string[]): RoleTemplate[] {
  const made: RoleTemplate[] = []
  for (const id of new Set(templateIds)) {
    const existing = db.prepare('SELECT * FROM role_template WHERE id = ?').get(id) as RoleRow | undefined
    if (existing) {
      made.push(toRole(existing))
      continue
    }
    const template = roleTemplate(id)
    if (template) made.push(insertTemplate(db, template))
  }
  return made
}

function countRoles(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM role_template').get() as { n: number }).n
}

/** Puts a built-in template in this Company, under the template's own id, at the end of the list. */
function insertTemplate(db: DatabaseSync, template: RoleBlueprint): RoleTemplate {
  const role: RoleTemplate = { ...template, seeded: true }
  ensureUniqueName(db, 'role_template', role.name, 'A role')
  const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM role_template').get() as {
    next: number
  }
  db.prepare(
    `INSERT INTO role_template (id, name, persona, capabilities, repo_filter, mcp_servers, skills, seeded, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    role.id,
    role.name,
    role.persona,
    JSON.stringify(role.capabilities),
    JSON.stringify(role.repoFilter),
    JSON.stringify(role.mcpServers),
    JSON.stringify(role.skills),
    next,
  )
  return role
}

/**
 * The id a new role takes: the template's own word when it names one and nothing holds it yet, so
 * `pm` is `pm` in every Company a preset can name; otherwise a fresh one.
 */
function roleIdFor(db: DatabaseSync, templateId: string | undefined): string {
  if (templateId === undefined || roleTemplate(templateId) === null) return randomUUID()
  const taken = db.prepare('SELECT 1 FROM role_template WHERE id = ?').get(templateId)
  return taken ? randomUUID() : templateId
}

/** Everyone whose row points at this role, former Employees last: a rehire walks back onto it. */
function holdersOf(db: DatabaseSync, roleId: string): { id: string; name: string; fired: boolean }[] {
  const rows = db
    .prepare('SELECT id, name, fired_at FROM employee WHERE role_id = ? ORDER BY fired_at IS NOT NULL, rowid')
    .all(roleId) as { id: string; name: string; fired_at: string | null }[]
  return rows.map((row) => ({ id: row.id, name: row.name, fired: row.fired_at !== null }))
}

/** Why a role cannot go, and who to move: the refusal says both, so the boss never has to guess. */
function deleteRefusal(role: RoleTemplate, held: { name: string; fired: boolean }[]): string {
  const onStaff = held.filter((holder) => !holder.fired).map((holder) => holder.name)
  const former = held.filter((holder) => holder.fired).map((holder) => holder.name)
  const parts = [
    ...(onStaff.length > 0 ? [`${names(onStaff)} ${onStaff.length === 1 ? 'is' : 'are'} on it`] : []),
    ...(former.length > 0 ? [`${names(former)} can be rehired onto it`] : []),
  ]
  return `${role.name} cannot be deleted: ${parts.join(', and ')}. Move them to another role first.`
}

/** `Ada`, `Ada and Vega`, `Ada, Vega and Sol`. */
function names(list: string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
