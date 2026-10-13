/**
 * The Hire Employee modal as pure data (design/html/hire-employee.html, frame `zf2Ks`): what the
 * fields hold, what the header and footer say, and the `EmployeeInput` the Hire button sends.
 */

import type { Provider } from '../../../shared/domain/providers'
import {
  type Areas,
  DEFAULT_PERMISSION_MODE,
  type Employee,
  type EmployeeInput,
  matchesRepoFilter,
  type PermissionMode,
  type RepoFilter,
  type RoleTemplate,
} from '../../../shared/domain/staff'
import type { Headcount } from '../../../shared/hiring'

/** Everything the modal's controls hold. `repoFilter` stays the role's globs until a chip is edited. */
export interface HireDraft {
  roleId: string
  name: string
  /** A model id from the catalogue, or null for the Provider's own default. */
  model: string | null
  /**
   * The Provider that owns the model — the model picker sets both at once (T139). With no model it
   * is the Provider the hire runs on, and the one this Mac is ready for until the boss moves it
   * (T169).
   */
  provider: Provider
  persona: string
  repoFilter: RepoFilter
  /** The paths inside a repo it works in; the role's until the boss edits them (T239). */
  areas: Areas
  /** The Company's MCP servers this hire walks in with; the role's until a chip is turned off (T136). */
  mcpServers: string[]
  /** The Company's skill folders it walks in with; the role's until a chip is turned off (T137). */
  skills: string[]
  /**
   * Whether this hire's Session runs without stopping to ask (T164), or null while the boss has
   * not chosen: the hire then names none and the engine hands it the Company's own default, so
   * there is one answer to what a hire starts with rather than a copy of it in this form.
   */
  permissionMode: PermissionMode | null
  /** The character sheet the LOOK tile shows. */
  sprite: number
}

/** The role the modal opens on: the one it was asked for, else the catalog's first. */
export function openOn(roles: RoleTemplate[], roleId: string | undefined): RoleTemplate | undefined {
  return (roleId === undefined ? undefined : roles.find((r) => r.id === roleId)) ?? roles[0]
}

/**
 * The draft a role fills: its persona and repo access, with the boss's name, model and look kept.
 *
 * `defaultProvider` is what the hire opens on when `keep` carries none: the Provider this Mac can
 * actually run today (T169, `pickDefaultProvider`). The modal reads it from the preflight answers
 * it already holds, so nothing here has to know which products exist.
 */
export function draftForRole(
  role: RoleTemplate | undefined,
  keep: Pick<HireDraft, 'name' | 'model' | 'sprite'> & Partial<Pick<HireDraft, 'provider' | 'permissionMode'>>,
  defaultProvider: Provider,
): HireDraft {
  return {
    provider: defaultProvider,
    // Nothing chosen: the Company's default stands, and the modal shows it.
    permissionMode: null,
    ...keep,
    roleId: role?.id ?? '',
    persona: role?.persona ?? '',
    repoFilter: role?.repoFilter ?? [],
    areas: role?.areas ?? [],
    mcpServers: role?.mcpServers ?? [],
    skills: role?.skills ?? [],
  }
}

/** What the Hire button sends. The sprite goes with it, so the chosen character walks into the office. */
export function hireInput(draft: HireDraft): EmployeeInput {
  return {
    name: draft.name.trim(),
    roleId: draft.roleId,
    persona: draft.persona,
    repoFilter: draft.repoFilter,
    areas: draft.areas,
    mcpServers: draft.mcpServers,
    skills: draft.skills,
    // The model carries its Provider: the Employee is hired onto the product that runs it (T139).
    provider: draft.provider,
    // Left out while the boss has not chosen, so the engine applies the Company's default.
    ...(draft.permissionMode !== null && { permissionMode: draft.permissionMode }),
    model: draft.model,
    sprite: draft.sprite,
  }
}

/** True when the draft can be hired: it needs a role and a name nobody on staff already has. */
export function canHire(draft: HireDraft, employees: Employee[]): boolean {
  const name = draft.name.trim().toLowerCase()
  return draft.roleId !== '' && name !== '' && !employees.some((e) => e.name.trim().toLowerCase() === name)
}

/** The header's second line: `Tiny Corp · seat 7 of 12`, or just the seat when headcount is unlimited. */
export function seatLine(companyName: string, headcount: Headcount | null): string {
  if (!headcount) return companyName
  const seat = headcount.current + 1
  return headcount.max === null ? `${companyName} · seat ${seat}` : `${companyName} · seat ${seat} of ${headcount.max}`
}

/**
 * The desk the hire takes, as the office numbers them for people: the engine seats them at the lowest
 * free index, counting fired Employees, who keep theirs.
 */
export function nextDesk(employees: Employee[], former: Employee[]): number {
  const taken = new Set([...employees, ...former].map((e) => e.desk))
  let desk = 0
  while (taken.has(desk)) desk++
  return desk + 1
}

/** The footer's note: what hiring does, in the design's words. */
export function walkInNote(name: string, desk: number): string {
  const who = name.trim() || 'They'
  return `${who} walks in, takes desk ${desk} and says hello in #general.`
}

/** The repos a filter lets an Employee into, in the Company's repo order. */
export function selectedRepos(filter: RepoFilter, repoNames: string[]): string[] {
  return repoNames.filter((repo) => matchesRepoFilter(filter, repo))
}

/** The repos a chip row can still add, in the Company's repo order. */
export function addableRepos(filter: RepoFilter, repoNames: string[]): string[] {
  return repoNames.filter((repo) => !matchesRepoFilter(filter, repo))
}

/**
 * Drops one repo. The filter stops being the role's globs and becomes the repos it resolved to, minus
 * this one — the chips the boss sees are exactly what they get.
 */
export function withoutRepo(filter: RepoFilter, repoNames: string[], repo: string): RepoFilter {
  return selectedRepos(filter, repoNames).filter((name) => name !== repo)
}

/** Adds one repo, pinning the filter to explicit names for the same reason. */
export function withRepo(filter: RepoFilter, repoNames: string[], repo: string): RepoFilter {
  const chosen = new Set([...selectedRepos(filter, repoNames), repo])
  return repoNames.filter((name) => chosen.has(name))
}

/**
 * The permission mode the PERMISSIONS chips show: the boss's choice, else the Company's default,
 * else the app's — which is what a Company with no answer yet would hand the hire anyway.
 */
export function shownPermission(draft: HireDraft, companyDefault: PermissionMode | null): PermissionMode {
  return draft.permissionMode ?? companyDefault ?? DEFAULT_PERMISSION_MODE
}

/** The character the prev/next arrows move to, wrapping around the sheets. */
export function stepLook(sprite: number, delta: number, count: number): number {
  if (count < 1) return sprite
  return (((sprite + delta) % count) + count) % count
}

/** The character shuffle rolls: never the one already showing, so the tile always changes. */
export function rerollLook(sprite: number, count: number, random: number): number {
  if (count < 2) return sprite
  return stepLook(sprite, 1 + Math.floor(random * (count - 1)), count)
}
