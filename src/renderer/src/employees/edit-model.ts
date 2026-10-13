/**
 * Edit Employee (frame `FbR2n`) as pure data: what the one screen holds, what its header and footer
 * say, which fields the Employee has made its own, and the `EmployeePatch` Save sends.
 *
 * The role can change here, and that is the part this module exists for: the same
 * `overridesAfterEdit` the engine saves with decides, before Save, which fields follow the new role
 * and which stay the Employee's own — so the marker the boss reads is the one that lands.
 */

import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import {
  type Areas,
  CAPABILITIES,
  type Capability,
  type Employee,
  type EmployeePatch,
  type JobField,
  type PermissionMode,
  type Provider,
  type RepoFilter,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import { FALLBACK_PROVIDER } from '../../../shared/staff/models'
import { type Job, jobAfterRoleChange, overridesAfterEdit } from '../../../shared/staff/role-follow'

/** Everything the modal's controls hold. */
export interface EditDraft {
  roleId: string
  name: string
  /** The character sheet the LOOK tile shows. */
  sprite: number
  /** A model id from the catalogue, or null for the Provider's own default. */
  model: string | null
  /** The Provider that owns the model; the model picker sets both at once (T139). */
  provider: Provider
  permissionMode: PermissionMode
  persona: string
  repoFilter: RepoFilter
  /** The paths inside a repo this Employee works in; `[]` is all of them (T239). */
  areas: Areas
  /** The Company's MCP servers this Employee holds, as ids into the catalogue (T136). */
  mcpServers: string[]
  /** The Company's skill folders this Employee holds, as ids into the catalogue (T137). */
  skills: string[]
  capabilities: Capability[]
  /** Fields the boss has reset: they take the role's values again and follow its edits. */
  followRole: JobField[]
}

/** The Employee as the modal opens on it: every control starts where the Employee stands today. */
export function draftForEmployee(employee: Employee): EditDraft {
  return {
    roleId: employee.roleId,
    name: employee.name,
    sprite: employee.sprite,
    model: employee.model,
    // An Employee already has a Provider; the fallback is only for a row written by a build that
    // predates the column, and those Employees ran on the catalogue's first product (T169).
    provider: employee.provider ?? FALLBACK_PROVIDER,
    permissionMode: employee.permissionMode,
    persona: employee.persona,
    repoFilter: employee.repoFilter,
    areas: employee.areas,
    mcpServers: employee.mcpServers,
    skills: employee.skills,
    capabilities: employee.capabilities,
    followRole: [],
  }
}

/** The job fields the draft holds, in the shape the override machinery reads. */
export function draftJob(draft: EditDraft): Job {
  return {
    persona: draft.persona,
    capabilities: draft.capabilities,
    repoFilter: draft.repoFilter,
    areas: draft.areas,
    mcpServers: draft.mcpServers,
    skills: draft.skills,
  }
}

/**
 * Which job fields the draft has made the Employee's own — what Save will record, computed before
 * Save from the same function the engine saves with.
 */
export function draftOverrides(options: {
  role: RoleTemplate | undefined
  employee: Employee
  draft: EditDraft
}): JobField[] {
  const { role, employee, draft } = options
  if (!role) return employee.overrides
  return overridesAfterEdit({ role, before: employee, after: draftJob(draft), followRole: draft.followRole })
}

/**
 * The draft after the boss picks another role. A field the Employee has not made its own follows
 * the new role and takes its value; a field it has made its own keeps it. Nothing else moves:
 * changing a role is not re-hiring.
 */
export function withRole(draft: EditDraft, role: RoleTemplate, overridden: JobField[]): EditDraft {
  return {
    ...draft,
    roleId: role.id,
    ...jobAfterRoleChange(role, { ...draftJob(draft), overrides: overridden }),
  }
}

/** The role's own values for one field, put back under the boss's reset. */
export function withFollowRole(draft: EditDraft, role: RoleTemplate, field: JobField): EditDraft {
  return {
    ...draft,
    [field]: role[field],
    followRole: [...draft.followRole.filter((f) => f !== field), field],
  }
}

/**
 * An edit to one job field. It stops following the role the moment the boss types in it, so a reset
 * the boss then edits is the boss's value again.
 */
export function withJobEdit<K extends JobField>(draft: EditDraft, field: K, value: Job[K]): EditDraft {
  return { ...draft, [field]: value, followRole: draft.followRole.filter((f) => f !== field) }
}

/** What Save sends. Every field the modal draws goes, so nothing it shows can be silently dropped. */
export function editPatch(draft: EditDraft): EmployeePatch {
  return {
    name: draft.name.trim(),
    roleId: draft.roleId,
    sprite: draft.sprite,
    provider: draft.provider,
    model: draft.model,
    permissionMode: draft.permissionMode,
    persona: draft.persona,
    repoFilter: draft.repoFilter,
    areas: draft.areas,
    mcpServers: draft.mcpServers,
    skills: draft.skills,
    capabilities: draft.capabilities,
    followRole: draft.followRole,
  }
}

/** True when Save may run: an Employee needs a name nobody else on staff already has. */
export function canSave(draft: EditDraft, employee: Employee, employees: Employee[]): boolean {
  const name = draft.name.trim().toLowerCase()
  return (
    draft.roleId !== '' &&
    name !== '' &&
    !employees.some((e) => e.id !== employee.id && e.name.trim().toLowerCase() === name)
  )
}

/** The header's second line: `Tiny Corp · Frontend · hired 12 Sep · desk 4`. */
export function whoLine(companyName: string, employee: Employee, role: RoleTemplate | undefined): string {
  const parts = [companyName, role?.name ?? employee.title]
  const hired = hiredOn(employee.createdAt)
  if (hired) parts.push(`hired ${hired}`)
  // Desks are numbered from zero in the engine and from one for people, as the office numbers them.
  parts.push(`desk ${employee.desk + 1}`)
  return parts.join(' · ')
}

/** The design writes months in three letters; spelled out here so no locale data can reword them. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `12 Sep`; an Employee with no hire date on record contributes nothing to the line. */
function hiredOn(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/**
 * What the modal's sentences call the Employee: its given name, the first word of its name. The
 * frame writes `Ada’s own` and `Folders of instructions Ada can open` under a NAME field holding
 * `Ada Lorne`; the title, `Edit Ada Lorne`, is the one place the full name is used.
 */
export function givenName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/**
 * The footer's note: what saving does to the Session that is running (T268). `who` is the given
 * name. A Session reads what the modal edits only when it is spawned, so saving restarts it where
 * it stands, and never mid-turn.
 */
export function saveNote(who: string): string {
  who = who.trim() || 'This Employee'
  return `Saving restarts ${who}’s Session to take the change: right away if it is idle, or when its turn ends.`
}

/**
 * Where a chip row's grants came from, in the frame's words: `Its role gives it linear; playwright
 * is Ada’s own.` Generated from the override machinery, never written by hand — the same set
 * difference the engine records as an override.
 */
export function grantLine(options: { who: string; fromRole: string[]; on: string[] }): string {
  const { fromRole, on } = options
  const who = options.who.trim() || 'this Employee'
  const given = on.filter((item) => fromRole.includes(item))
  const own = on.filter((item) => !fromRole.includes(item))
  const dropped = fromRole.filter((item) => !on.includes(item))
  if (!given.length && !own.length && !dropped.length) {
    return `Its role gives it none, and ${who} has added none.`
  }
  const clauses = [
    given.length ? `its role gives it ${list(given)}` : '',
    // The frame's own second clause — but only where the first one already carries the subject. A
    // sentence may not open on a grant's name: these are identifiers, and capitalising one is a lie.
    own.length
      ? given.length
        ? `${list(own)} ${own.length === 1 ? 'is' : 'are'} ${who}’s own`
        : `${who} added ${list(own)}`
      : '',
    dropped.length ? `${who} turned ${list(dropped)} off` : '',
  ].filter(Boolean)
  const sentence = clauses.join('; ')
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`
}

/** `a`, `a and b`, `a, b and c` — the design writes lists out rather than counting them. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** The INTEGRATIONS row: the Company's MCP catalogue, in its own order (T136). */
export function integrationChips(servers: McpServerRow[]): { id: string; label: string }[] {
  return servers.map((server) => ({ id: server.id, label: server.name }))
}

/**
 * The row's order as frame `FbR2n` draws it — the work first, then the planning around it — rather
 * than `CAPABILITIES`' own order, which the engine keeps and a save still writes in (`toCapabilities`).
 */
const CAPABILITY_ROW: readonly Capability[] = ['code', 'review', 'test', 'plan', 'intake', 'hire']

/** The CAPABILITIES row: what an Employee is allowed to do, in the frame's order. */
export function capabilityChips(): { id: string; label: string }[] {
  return CAPABILITY_ROW.map((capability) => ({ id: capability, label: capability }))
}

/**
 * A grant row as the frame draws it: what the Employee holds first, then the rest, each in the
 * catalogue's order. `held` is what it held when the modal opened, so a chip the boss presses stays
 * where it is rather than jumping to the other end of the row under the pointer.
 */
export function heldFirst<T extends { id: string }>(items: readonly T[], held: readonly string[]): T[] {
  return [...items.filter((item) => held.includes(item.id)), ...items.filter((item) => !held.includes(item.id))]
}

/** The capabilities the ids stand for, in the catalogue's order. */
export function toCapabilities(ids: string[]): Capability[] {
  return CAPABILITIES.filter((capability) => ids.includes(capability))
}

/** Names, for a grant line, of the servers a set of ids stands for. */
export function serverNames(servers: McpServerRow[], ids: string[]): string[] {
  return servers.filter((server) => ids.includes(server.id)).map((server) => server.name)
}

/** The same, for skill folders: the SKILLS row is the INTEGRATIONS row over another catalogue (T137). */
export function skillNames(skills: SkillRow[], ids: string[]): string[] {
  return skills.filter((skill) => ids.includes(skill.id)).map((skill) => skill.name)
}

/**
 * The SKILLS row's sentence, in the frame's words: `Folders of instructions Ada can open.` It then
 * says where the grants came from through the same `grantLine` the INTEGRATIONS row uses, so one
 * function writes both rows' provenance and neither can drift.
 *
 * The frame's own caption spends its second half on the Provider caveat rather than on provenance —
 * it names the product that reads no skills and says it would say so here. Both are true of the
 * row, so both are said: the caveat is appended, and only on a Provider whose entry reads none.
 */
export function skillsLine(options: {
  who: string
  fromRole: string[]
  on: string[]
  providerLabel: string
  providerReadsSkills: boolean
}): string {
  const who = options.who.trim() || 'this Employee'
  const parts = [`Folders of instructions ${who} can open.`, grantLine(options)]
  if (!options.providerReadsSkills) parts.push(`${options.providerLabel} has no skills, and would not look at them.`)
  return parts.join(' ')
}
