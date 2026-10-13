import type { Provider } from './providers'

/**
 * What an Employee is allowed to do. Job titles are labels only; routing uses these.
 * `test` is the QA pass a ticket gets after review and before the merge (T174).
 */
export const CAPABILITIES = ['intake', 'plan', 'code', 'review', 'test', 'hire'] as const
export type Capability = (typeof CAPABILITIES)[number]

/**
 * The CLI products an Employee's Session can run on. They are defined once, in `providers.ts`,
 * and re-exported here because everything that knows about Employees already imports this module.
 */
export { PROVIDERS, type Provider } from './providers'

/** `skip-permissions` spawns with `--dangerously-skip-permissions`; `interactive` asks in the terminal. */
export const PERMISSION_MODES = ['skip-permissions', 'interactive'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/**
 * What a Company hands a hire that names no permission mode, and what every Company that existed
 * before the setting did gets: what they already ran with (T164).
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'skip-permissions'

/** The chips on the PERMISSIONS field, as the frames word them (`XJxrZ`, `PGtFO`, `V0AWNP`). */
export const PERMISSION_CHOICE_LABEL: Record<PermissionMode, string> = {
  'skip-permissions': 'Run without asking',
  interactive: 'Ask first',
}

/**
 * The same choice on the Employee drawer's meta strip (frame `Ysu8a`), where it is a statement
 * about a Session rather than a control: `Skips permissions`, or `Ask on edits`.
 */
export const PERMISSION_META_LABEL: Record<PermissionMode, string> = {
  'skip-permissions': 'Skips permissions',
  interactive: 'Ask on edits',
}

/**
 * The line under the chips on Edit Employee (`XJxrZ`), which is the only one of the three fields
 * whose help changes with the choice: it describes this Employee's own Session.
 */
export const PERMISSION_HELP: Record<PermissionMode, string> = {
  'skip-permissions': 'Its Session runs without stopping to ask. Starts with the CLI’s own skip flag.',
  interactive: 'Its Session asks in the terminal before it acts.',
}

/** The line under the chips on Hire Employee (`PGtFO`): the field opens on the Company's default. */
export const PERMISSION_HIRE_HELP = 'From the Company’s default. Change it here for this hire.'

/** The line under the chips in Company settings (`V0AWNP`). */
export const PERMISSION_DEFAULT_HELP = 'What a new Employee starts with. Each Employee can change its own.'

/**
 * Which of the Company's repos an Employee works in: glob patterns over repo names
 * (`*` matches any run of characters). `['*']` means every repo, `[]` means none.
 */
export type RepoFilter = string[]

/**
 * Which part of a repo an Employee works in: path globs over the repo's own paths,
 * `src/renderer/**` or `packages/api/**`. `[]` means the whole of every repo it may work in, which
 * is what everyone starts with — an area is how a monorepo tells a Frontend from a Backend, since
 * a repo name cannot (T239).
 */
export type Areas = string[]

/**
 * MCP servers an Employee is granted, as ids into the Company's catalogue (`mcp-servers.ts`).
 * `[]` means the Company's own server and nothing else, which is what everyone starts with.
 */
export type McpGrants = string[]

/**
 * Skill folders an Employee is granted, as ids into the Company's catalogue (`skills.ts`). `[]`
 * means the instructions the app generates and nothing else, which is what everyone starts with.
 */
export type SkillGrants = string[]

/**
 * The seeded role whose Employees do the security pass (T241). It is a role id rather than a
 * capability because what a Security Employee does — `review`, and `code` for the small fix — is
 * what the capabilities already say; which of the reviewers reads a change *for security* is the
 * job it was hired into. Renaming the role in the catalogue leaves the id, so it keeps working.
 */
export const SECURITY_ROLE_ID = 'security'

/** A role in the hiring catalog. Seeded templates are editable like any other. */
export interface RoleTemplate {
  id: string
  name: string
  persona: string
  capabilities: Capability[]
  repoFilter: RepoFilter
  /** The paths inside a repo this role works in; `[]` is all of them (T239). */
  areas: Areas
  /** The Company's MCP servers this role hands to everyone hired into it (T136). */
  mcpServers: McpGrants
  /** The Company's skill folders this role hands to everyone hired into it (T137). */
  skills: SkillGrants
  /** True for a role created from a built-in template, however edited since (T240). */
  seeded: boolean
}

export interface RoleTemplateInput {
  name: string
  persona: string
  capabilities: Capability[]
  repoFilter: RepoFilter
  areas: Areas
  mcpServers: McpGrants
  skills: SkillGrants
}

/** Creating a role: from a built-in template (`role-templates.ts`), or from nothing (T240). */
export interface RoleCreate extends RoleTemplateInput {
  /**
   * The built-in template this role comes from. The role is created under the template's own id,
   * so the team presets and `/hire <role>` keep naming it by the word they always have; a second
   * role from the same template gets a fresh id, because the first one already holds that word.
   */
  templateId?: string
}

/** Deleting a role. A role Employees hold is refused unless the boss says where they go. */
export interface RoleDeletion {
  /** Move everyone on the role — former Employees too — to this one first. */
  reassignTo?: string
}

export interface Employee {
  id: string
  name: string
  /** The catalog role this Employee was hired from. */
  roleId: string
  /** The role's name at hire time, shown as a label. */
  title: string
  persona: string
  capabilities: Capability[]
  repoFilter: RepoFilter
  /** The paths inside a repo this Employee works in; `[]` is all of them (T239). */
  areas: Areas
  /** The Company's MCP servers this Employee holds, on top of the Company's own (T136). */
  mcpServers: McpGrants
  /** The Company's skill folders this Employee holds (T137). */
  skills: SkillGrants
  provider: Provider
  permissionMode: PermissionMode
  /** A model id from the provider's catalog (`PROVIDER_MODELS`), or null for the provider's default. */
  model: string | null
  /**
   * Job fields this Employee set for itself. Every other job field follows the role:
   * editing the role template rewrites it (decision 34).
   */
  overrides: JobField[]
  /** Index of the Employee's desk in the office. Unique within a Company. */
  desk: number
  /** Index of the Employee's character sprite. */
  sprite: number
  createdAt: string
}

/** Hire from a role; anything left out is copied from the role template. */
export interface EmployeeInput {
  name: string
  roleId: string
  persona?: string
  capabilities?: Capability[]
  repoFilter?: RepoFilter
  areas?: Areas
  mcpServers?: McpGrants
  skills?: SkillGrants
  provider?: Provider
  permissionMode?: PermissionMode
  model?: string | null
  /** The character sheet this Employee walks in on; left out, the least-used one is handed over. */
  sprite?: number
}

/**
 * What an edit may change. `roleId` moves the Employee to another role, which is not a re-hire
 * (T138): the job fields it follows take the new role's values, the ones it overrode stay its own,
 * and its desk, character, Sessions and tickets are untouched.
 */
export type EmployeePatch = Partial<
  Pick<
    Employee,
    | 'name'
    | 'roleId'
    | 'persona'
    | 'capabilities'
    | 'repoFilter'
    | 'areas'
    | 'mcpServers'
    | 'skills'
    | 'provider'
    | 'permissionMode'
    | 'model'
    | 'sprite'
  >
> & {
  /** Drop these overrides: the fields take the role's values again and follow its edits. */
  followRole?: JobField[]
}

/** The fields an Employee takes from its role, and follows unless it overrides them. */
export const JOB_FIELDS = ['persona', 'capabilities', 'repoFilter', 'areas', 'mcpServers', 'skills'] as const
export type JobField = (typeof JOB_FIELDS)[number]

/**
 * Who turns the boss's goals into targets: the first Employee hired with `intake`, or the only
 * Employee of a one-Employee Company. Null when nobody does. `employees` is in hire order.
 */
export function intakeHolder(employees: Employee[]): Employee | null {
  return (
    employees.find((e) => e.capabilities.includes('intake')) ?? (employees.length === 1 ? (employees[0] ?? null) : null)
  )
}

/** Why an Employee in the answerer chain cannot answer now (decision 41). */
export type Unavailability = 'parked' | 'paused' | 'stopped' | 'out_of_budget'

/** Who answers a boss message, and how the chain got there. */
export interface AnswererChoice {
  /** The first available Employee in the chain, or null when nobody is. */
  answerer: Employee | null
  /** The head of the chain, availability aside: who an unanswered message waits for. */
  first: Employee | null
  /** Everyone passed over before the answerer (or all of the chain when nobody answers), in chain order. */
  skipped: { employee: Employee; reason: Unavailability }[]
  /**
   * The boss's "Who answers you" choice, or null for Automatic. `stale` says why it does not
   * answer: `fired` it is not on staff, `unavailable` it was skipped.
   */
  override: { id: string; stale: 'fired' | 'unavailable' | null } | null
}

/**
 * The answerer chain (decision 41): the boss's override, then every `intake` holder, every `plan`
 * holder and everyone else, each in hire order. `employees` is in hire order.
 */
export function answererChain(employees: Employee[], overrideId: string | null = null): Employee[] {
  const chain = [
    ...employees.filter((e) => e.id === overrideId),
    ...employees.filter((e) => e.capabilities.includes('intake')),
    ...employees.filter((e) => e.capabilities.includes('plan')),
    ...employees,
  ]
  return [...new Set(chain)]
}

/** The first available Employee of the answerer chain; `unavailable` says why someone cannot answer now. */
export function resolveAnswerer(
  employees: Employee[],
  {
    overrideId = null,
    unavailable = () => null,
  }: { overrideId?: string | null; unavailable?: (employee: Employee) => Unavailability | null } = {},
): AnswererChoice {
  const chain = answererChain(employees, overrideId)
  const skipped: AnswererChoice['skipped'] = []
  let answerer: Employee | null = null
  for (const employee of chain) {
    const reason = unavailable(employee)
    if (!reason) {
      answerer = employee
      break
    }
    skipped.push({ employee, reason })
  }
  const override =
    overrideId === null
      ? null
      : {
          id: overrideId,
          stale: !employees.some((e) => e.id === overrideId)
            ? ('fired' as const)
            : answerer?.id === overrideId
              ? null
              : ('unavailable' as const),
        }
  return { answerer, first: chain[0] ?? null, skipped, override }
}

export function matchesRepoFilter(filter: RepoFilter, repoName: string): boolean {
  return filter.some((pattern) => globToRegExp(pattern).test(repoName))
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** The filter that lets an Employee into every repo, which is what "Allow all repos" writes. */
export const EVERY_REPO: RepoFilter = ['*']

/**
 * Whether a filter shuts someone out of the whole Company (T239): they write code, the Company has
 * repos, and the filter matches none of them. A PM with no repo filter is not shut out of anything
 * — it does not work in repos — so only a holder of `code` can be.
 */
export function shutOutOfEveryRepo(who: Pick<Employee, 'capabilities' | 'repoFilter'>, repoNames: string[]): boolean {
  if (!who.capabilities.includes('code')) return false
  return repoNames.length > 0 && !repoNames.some((name) => matchesRepoFilter(who.repoFilter, name))
}

/** The one sentence the cards, Edit Employee, Repositories and the hire flow all say about it. */
export function shutOutLine(name: string): string {
  return `${name} can’t work in any of this Company’s repos`
}

/**
 * Where a ticket's work lands, which is what an area is matched against (T239). `repos` are the
 * Company's repo names it touches, `labels` its labels — how a planner names an area without
 * naming a path — and `paths` the paths the work is expected to touch, when they are known. A
 * label that looks like a path (`src/renderer`) counts as one.
 */
export interface TicketArea {
  repos: string[]
  labels?: string[]
  paths?: string[]
}

/** The three fields that decide who takes a ticket. Employees and role templates both have them. */
export type Assignable = Pick<Employee, 'capabilities' | 'repoFilter' | 'areas'>

/** Whether this Employee writes code and may work in every repo the ticket touches. */
export function canTakeTicket(who: Assignable, ticket: TicketArea): boolean {
  return who.capabilities.includes('code') && ticket.repos.every((repo) => matchesRepoFilter(who.repoFilter, repo))
}

/**
 * Whether an Employee's areas cover a ticket's work: a path it touches falls inside one of them, or
 * one of its labels names one — `renderer` names `src/renderer/**`. An Employee that names no area
 * matches nothing here: it is covered by the fallback in `rankAssignees`, not by an area.
 */
export function matchesArea(areas: Areas, ticket: TicketArea): boolean {
  const labels = (ticket.labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean)
  const paths = [...(ticket.paths ?? []), ...labels.filter((label) => label.includes('/'))]
  return areas.some(
    (area) => paths.some((path) => pathInArea(area, path)) || labels.some((label) => areaWords(area).includes(label)),
  )
}

/**
 * Who should take a ticket, best first (T239). Candidates are the Employees who write code and may
 * work in every repo it touches; among them an area that matches the ticket comes first, then
 * whoever names no area, then whoever's areas are elsewhere. At every step an engineer comes before
 * a planner: the lead plans and reviews, and codes only when no engineer can. Ties keep the order
 * given, which is hire order.
 */
export function rankAssignees<T extends Assignable>(candidates: T[], ticket: TicketArea): T[] {
  return candidates
    .filter((who) => canTakeTicket(who, ticket))
    .map((who, order) => ({ who, order, rank: assignmentRank(who, ticket) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ who }) => who)
}

/** The one who should take it, or null when nobody can. */
export function preferredAssignee<T extends Assignable>(candidates: T[], ticket: TicketArea): T | null {
  return rankAssignees(candidates, ticket)[0] ?? null
}

/** Lower takes it first: the area first, the lead last. */
function assignmentRank(who: Assignable, ticket: TicketArea): number {
  const lead = who.capabilities.includes('plan') ? 3 : 0
  if (matchesArea(who.areas, ticket)) return lead
  return lead + (who.areas.length === 0 ? 1 : 2)
}

/**
 * Whether a path is in an area. An area names a folder, so it holds what is under it as well as
 * itself: `src/renderer/**`, `src/renderer` and `src/*` all hold `src/renderer/App.tsx`. A single
 * `*` still stops at the folder it is in, where `**` runs past it.
 */
function pathInArea(area: string, path: string): boolean {
  const wanted = posix(path)
  const pattern = posix(area)
  if (!pattern) return false
  if (!pattern.includes('*')) return wanted === pattern || wanted.startsWith(`${pattern}/`)
  const escaped = pattern
    .split(/(\*\*\/?|\*)/)
    .map((part) => (part.startsWith('**') ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${escaped}(/|$)`, 'i').test(wanted)
}

/** The literal words of an area, which is what a label names: `apps/web/**` is `apps` and `web`. */
function areaWords(area: string): string[] {
  return posix(area)
    .split('/')
    .map((part) => part.replace(/\*/g, '').toLowerCase())
    .filter(Boolean)
}

/** A path as an area is written: POSIX separators, no leading `./` or `/`, no trailing slash. */
function posix(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
}
