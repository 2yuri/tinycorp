import type { Company } from '../../../shared/company'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import { hasChecks, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { tildePath } from '../paths'
import { accessOf, type CommandKey, stackCommands } from '../repositories'

/** Repos added this soon after the Company count as connected at Create Company. */
const CREATED_WITH_COMPANY_MS = 5 * 60_000

/** A connected repo as its CONNECTED card shows it. */
export interface ConnectedCard {
  id: string
  name: string
  /** The default branch, or null when git cannot tell. */
  branch: string | null
  /** `~/code/tinycorp/web-app · added when you created the company`. */
  pathLine: string
  /** "About this repo", edited in place on the card. */
  brief: string
  /** Whether the repo has any Checks; otherwise it shows the soft "No checks yet". */
  checksDetected: boolean
  commands: { key: CommandKey; command: string }[]
  /** The working roles whose repo filter lets them in, by name. */
  roles: string[]
}

export function connectedCards(
  company: Pick<Company, 'createdAt'>,
  repos: Repo[],
  inspections: Record<string, RepoInspection | undefined>,
  roles: RoleTemplate[],
  employees: Employee[],
): ConnectedCard[] {
  const created = Date.parse(company.createdAt)
  return repos.map((repo) => {
    const withCompany = Date.parse(repo.addedAt) - created < CREATED_WITH_COMPANY_MS
    return {
      id: repo.id,
      name: repo.name,
      branch: inspections[repo.id]?.defaultBranch ?? null,
      pathLine: `${tildePath(repo.path)} · ${withCompany ? 'added when you created the company' : 'connected during setup'}`,
      brief: repo.brief,
      checksDetected: hasChecks(repo.stack),
      commands: stackCommands(repo.stack),
      roles: accessOf(repo.name, roles, employees).roles.map((role) => role.name),
    }
  })
}

/** `FOUND IN ~/code/tinycorp · 110 REPOSITORIES`, over the tree of what the walk found. */
export function foundLabel(folder: string, repos: number): string {
  return `FOUND IN ${tildePath(folder)} · ${repos.toLocaleString()} ${repos === 1 ? 'REPOSITORY' : 'REPOSITORIES'}`
}

/** `Connected (core)` while the names still fit; just `Connected` once there are more than two. */
export function connectedLabel(repos: readonly Repo[]): string {
  return repos.length > 0 && repos.length <= 2
    ? `Connected (${repos.map((repo) => repo.name).join(', ')})`
    : 'Connected'
}

/** The counts down the side of the step, under How repos are used. */
export function repoCounts(repos: Repo[], offered: number, selected: number) {
  return {
    connected: repos.length,
    described: repos.filter((repo) => repo.brief.trim() !== '').length,
    selected,
    found: Math.max(0, offered - selected),
  }
}

/**
 * The team needs somewhere to work before the First ticket step. Repos ticked in the tree count:
 * they are added the moment the boss continues, which is what the step says on it (T168).
 */
export function canLeaveRepositories(connected: number, selected = 0): boolean {
  return connected + selected > 0
}
