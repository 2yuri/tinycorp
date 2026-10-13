import {
  type Employee,
  matchesRepoFilter,
  type RepoFilter,
  type RoleTemplate,
  shutOutOfEveryRepo,
} from '../../../shared/domain/staff'
import { FORGE_COMMAND, FORGE_LABEL, type Forge, forgeOf, remoteHost } from '../../../shared/forges'
import type { Repo, RepoInspection, RepoRung, StackConstraints } from '../../../shared/repos/repo'

/** What a repo card says about its forge: which mark to draw, and the line under it. */
export interface RepoForge {
  /** The catalogued forge its `origin` is on, or null: no remote, or a host no adapter claims. */
  forge: Forge | null
  /** The title on the mark — the forge and its CLI, or why no pull request can be opened here. */
  title: string
}

/**
 * The forge a repo is on, read from the `origin` git reports (never stored): a Company can hold
 * repos on several at once, and a repo that moves host says so the next time the card is drawn.
 *
 * A repo on a host no forge in the catalogue claims still works for everything local. The card
 * says that here, rather than leaving an Employee to find out when the work is ready.
 */
export function repoForge(inspection: RepoInspection | undefined): RepoForge {
  const remote = inspection?.remote ?? null
  const forge = forgeOf(remote)
  if (forge) return { forge, title: `${FORGE_LABEL[forge]} — pull requests are opened with ${FORGE_COMMAND[forge]}` }
  if (!remote) return { forge: null, title: 'No remote — nothing is pushed from here, and no pull request is opened' }
  return {
    forge: null,
    title: `No adapter for ${remoteHost(remote) ?? remote} — everything local works here; the pull request is yours to open`,
  }
}

export const COMMAND_KEYS = ['install', 'build', 'test', 'lint'] as const
export type CommandKey = (typeof COMMAND_KEYS)[number]

/** The STACK chips of a card: the commands that are set, in order. */
export function stackCommands(stack: StackConstraints): { key: CommandKey; command: string }[] {
  return COMMAND_KEYS.filter((key) => stack[key] !== '').map((key) => ({ key, command: stack[key] }))
}

/** `TypeScript · React` next to the repo name. */
export function languageLine(stack: StackConstraints): string {
  return [stack.language, stack.framework].filter(Boolean).join(' · ')
}

/** `pnpm 9` in the package manager select. */
export function packageManagerLabel(stack: Pick<StackConstraints, 'packageManager' | 'packageManagerVersion'>): string {
  return [stack.packageManager, stack.packageManagerVersion].filter(Boolean).join(' ')
}

/**
 * How loud the rung chip is: `merges` is the default and says nothing, `PR only` is a warning and
 * `local only` an error, as the frame draws them (decision 61).
 */
export function rungTone(rung: RepoRung): 'neutral' | 'warning' | 'error' {
  if (rung === 'pr') return 'warning'
  if (rung === 'local') return 'error'
  return 'neutral'
}

/** The roles offered under "Who can work here": the ones that write or review code. */
export function workingRoles(roles: RoleTemplate[]): RoleTemplate[] {
  return roles.filter((role) => role.capabilities.includes('code') || role.capabilities.includes('review'))
}

/** Who may work in a repo: the working roles and the Employees whose repo filter matches its name. */
export function accessOf(repoName: string, roles: RoleTemplate[], employees: Employee[]) {
  return {
    roles: workingRoles(roles).filter((role) => matchesRepoFilter(role.repoFilter, repoName)),
    employees: employees.filter((employee) => matchesRepoFilter(employee.repoFilter, repoName)),
  }
}

/**
 * The Employees these repos let nowhere (T239): they write code, and no repo on this screen matches
 * their filter. This is the screen that decides repo access, so it is the screen that says it — and
 * offers each of them "Allow all repos".
 */
export function shutOutEmployees(repos: Pick<Repo, 'name'>[], employees: Employee[]): Employee[] {
  const names = repos.map((repo) => repo.name)
  return employees.filter((employee) => shutOutOfEveryRepo(employee, names))
}

/** `Frontend · Tech Lead · QA`, `DevOps only`, or `Nobody yet`. */
export function accessLine(roles: RoleTemplate[]): string {
  if (roles.length === 0) return 'Nobody yet'
  if (roles.length === 1) return `${roles[0]!.name} only`
  return roles.map((role) => role.name).join(' · ')
}

/** At most four avatars: all of them, or three and `+N`. */
export function avatarSlots<T>(people: T[]): { shown: T[]; more: number } {
  if (people.length <= 4) return { shown: people, more: 0 }
  return { shown: people.slice(0, 3), more: people.length - 3 }
}

/** A filter that also lets `repoName` in. */
export function allowRepo(filter: RepoFilter, repoName: string): RepoFilter {
  return matchesRepoFilter(filter, repoName) ? filter : [...filter, repoName]
}

/**
 * A filter that keeps `repoName` out and everything else it allowed among `otherRepos`.
 * A glob that matched the repo is replaced by the other repos it matched.
 */
export function denyRepo(filter: RepoFilter, repoName: string, otherRepos: string[]): RepoFilter {
  if (!matchesRepoFilter(filter, repoName)) return filter
  const next: string[] = []
  for (const pattern of filter) {
    if (!matchesRepoFilter([pattern], repoName)) next.push(pattern)
    else if (pattern.includes('*')) next.push(...otherRepos.filter((name) => matchesRepoFilter([pattern], name)))
  }
  return [...new Set(next)]
}

/**
 * The role repo filter edits that make exactly `allowed` (role ids) the working roles of `repoName`.
 * The engine carries each edit on to the role's Employees that have not overridden their filter (decision 34).
 */
export function accessChanges(
  repoName: string,
  allowed: ReadonlySet<string>,
  repos: Pick<Repo, 'name'>[],
  roles: RoleTemplate[],
): { id: string; repoFilter: RepoFilter }[] {
  const others = repos.map((repo) => repo.name).filter((name) => name.toLowerCase() !== repoName.toLowerCase())
  return workingRoles(roles)
    .filter((role) => matchesRepoFilter(role.repoFilter, repoName) !== allowed.has(role.id))
    .map((role) => ({
      id: role.id,
      repoFilter: allowed.has(role.id)
        ? allowRepo(role.repoFilter, repoName)
        : denyRepo(role.repoFilter, repoName, others),
    }))
}

/** `1,284 commits · last push 2h ago` under a detected remote. */
export function historyLine(commitCount: number | null, lastCommitAt: string | null, now = Date.now()): string {
  const parts: string[] = []
  if (commitCount !== null)
    parts.push(`${commitCount.toLocaleString('en-US')} ${commitCount === 1 ? 'commit' : 'commits'}`)
  if (lastCommitAt) parts.push(`last push ${ago(Date.parse(lastCommitAt), now)}`)
  return parts.join(' · ')
}

function ago(then: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

/** Package managers offered in the select, as `manager|version`. */
const COMMON_MANAGERS: [string, string][] = [
  ['pnpm', '10'],
  ['pnpm', '9'],
  ['npm', '11'],
  ['npm', '10'],
  ['yarn', '4'],
  ['bun', '1'],
  ['go modules', ''],
  ['cargo', ''],
]

export const managerValue = (manager: string, version: string) => `${manager}|${version}`

export function parseManagerValue(value: string): { packageManager: string; packageManagerVersion: string } {
  const [packageManager = '', packageManagerVersion = ''] = value.split('|')
  return { packageManager, packageManagerVersion }
}

/** The select's options: the current choice first when it is not a common one, then the common ones. */
export function packageManagerOptions(current: Pick<StackConstraints, 'packageManager' | 'packageManagerVersion'>) {
  const options = COMMON_MANAGERS.map(([manager, version]) => ({
    value: managerValue(manager, version),
    label: packageManagerLabel({ packageManager: manager, packageManagerVersion: version }),
  }))
  const value = managerValue(current.packageManager, current.packageManagerVersion)
  if (current.packageManager && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: packageManagerLabel(current) })
  }
  if (!current.packageManager) options.unshift({ value: managerValue('', ''), label: 'Choose a package manager' })
  return options
}
