/**
 * The Roles list, the New role dialog and what deleting a role takes with it (T240).
 *
 * Everything here is a pure reading of the three lists the screen already holds — the Company's
 * roles, the Employees on staff and the former ones — so it can be tested without a Company. The
 * engine is the one that refuses a delete; what is here decides what the boss is shown first.
 */
import type { Capability, Employee, RoleTemplate } from '../../../shared/domain/staff'
import { ROLE_TEMPLATES, type RoleBlueprint } from '../../../shared/staff/role-templates'
import type { RoleFields } from './forms'

/** One row of the Roles list: the role, who is on it, and whether anybody ever was. */
export interface RoleRow {
  role: RoleTemplate
  /** Employees on staff who hold it. */
  holders: Employee[]
  /** Former Employees who hold it; a rehire walks back onto the role, so it is still in use. */
  former: Employee[]
  /** `2 employees`, `1 employee`, or `Not used`. */
  count: string
  /** Nobody has ever been hired into it. */
  unused: boolean
  /** `intake · plan · hire · every repo`, the line under the name. */
  meta: string
}

export function roleRows(roles: RoleTemplate[], employees: Employee[], former: Employee[]): RoleRow[] {
  return roles.map((role) => {
    const holders = employees.filter((employee) => employee.roleId === role.id)
    const formerHolders = former.filter((employee) => employee.roleId === role.id)
    const unused = holders.length === 0 && formerHolders.length === 0
    return {
      role,
      holders,
      former: formerHolders,
      count: unused ? 'Not used' : `${holders.length} ${holders.length === 1 ? 'employee' : 'employees'}`,
      unused,
      meta: roleMeta(role),
    }
  })
}

/**
 * `intake · plan · hire · every repo · src/renderer/**`; `nothing yet` for a blank role the boss
 * has not filled in. The areas are T239's, read here rather than restated: a role that names none
 * works in the whole of every repo it may work in, and the line says nothing about them.
 */
export function roleMeta(role: RoleTemplate): string {
  const parts: string[] = [...role.capabilities]
  if (role.repoFilter.includes('*')) parts.push('every repo')
  else if (role.repoFilter.length > 0) parts.push(role.repoFilter.join(', '))
  if (role.areas.length > 0) parts.push(role.areas.join(', '))
  return parts.length > 0 ? parts.join(' · ') : 'nothing yet'
}

/**
 * The built-in roles this Company kept but never used. Only those: a role the boss wrote
 * themselves is theirs to delete one at a time, however empty, and is never swept by a bulk action.
 */
export function unusedSeeded(rows: RoleRow[]): RoleRow[] {
  return rows.filter((row) => row.unused && row.role.seeded)
}

/** The line under \"Remove unused roles\", or null when there is nothing to remove. */
export function removeUnusedNote(rows: RoleRow[]): string | null {
  const unused = unusedSeeded(rows)
  if (unused.length === 0) return null
  const names = unused.map((row) => row.role.name)
  return `${list(names)} came with the Company and nobody was ever hired into ${names.length === 1 ? 'it' : 'them'}.`
}

/** What a role's Employees have to be told before it can go, or null when it can just go. */
export function deleteBlocker(row: RoleRow): string | null {
  const onStaff = row.holders.map((employee) => employee.name)
  const gone = row.former.map((employee) => employee.name)
  if (onStaff.length === 0 && gone.length === 0) return null
  const parts = [
    ...(onStaff.length > 0 ? [`${list(onStaff)} ${onStaff.length === 1 ? 'is' : 'are'} on this role`] : []),
    ...(gone.length > 0 ? [`${list(gone)} can be rehired onto it`] : []),
  ]
  return `${parts.join(', and ')}. Pick where they go, or move them yourself first.`
}

/** A choice in the New role dialog: a built-in template, or the blank one at the end. */
export interface RoleChoice {
  /** The template's id, or null for the blank role. */
  templateId: string | null
  name: string
  description: string
  meta: string
  /** The Company already holds a role made from this template. */
  inCompany: boolean
}

export const BLANK_ROLE: RoleChoice = {
  templateId: null,
  name: 'Start blank',
  description: 'Nothing filled in. You write the persona and pick what it may do.',
  meta: '',
  inCompany: false,
}

/** Every built-in, the ones the Company has not taken first, and the blank role last. */
export function roleChoices(roles: RoleTemplate[]): RoleChoice[] {
  const held = new Set(roles.map((role) => role.id))
  const choices = ROLE_TEMPLATES.map((template) => ({
    templateId: template.id,
    name: template.name,
    description: firstSentence(template.persona),
    meta: roleMeta({ ...template, seeded: true }),
    inCompany: held.has(template.id),
  }))
  return [...choices.filter((choice) => !choice.inCompany), ...choices.filter((choice) => choice.inCompany), BLANK_ROLE]
}

/** What the editor opens on once a choice is made: the template's fields, or an empty form. */
export function fieldsForChoice(choice: RoleChoice, roles: RoleTemplate[]): RoleFields {
  const template = ROLE_TEMPLATES.find((t) => t.id === choice.templateId)
  if (!template) {
    return { name: '', persona: '', capabilities: [], repoFilter: [], areas: [], mcpServers: [], skills: [] }
  }
  return { ...fieldsOf(template), name: freeName(template.name, roles) }
}

function fieldsOf(template: RoleBlueprint): RoleFields {
  return {
    name: template.name,
    persona: template.persona,
    capabilities: [...template.capabilities] as Capability[],
    repoFilter: [...template.repoFilter],
    areas: [...template.areas],
    mcpServers: [...template.mcpServers],
    skills: [...template.skills],
  }
}

/** `QA`, then `QA 2`, `QA 3`: a name the Company does not already have, since two may not clash. */
function freeName(name: string, roles: RoleTemplate[]): string {
  const taken = new Set(roles.map((role) => role.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  let n = 2
  while (taken.has(`${name} ${n}`.toLowerCase())) n++
  return `${name} ${n}`
}

/** The persona's first sentence, which is what a template card says about it. */
function firstSentence(persona: string): string {
  const sentences = persona.match(/[^.!?]+[.!?]/g) ?? []
  // The first sentence of every built-in is "You are the QA engineer."; the one after it says the job.
  return (sentences[1] ?? sentences[0] ?? persona).trim()
}

/** `Ada`, `Ada and Vega`, `Ada, Vega and Sol`. */
function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
