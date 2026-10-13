import type { RemoteOffer, RepoStartPlan } from '../../../shared/repos/repo'

/**
 * What the New repository source says (frames `gFdvh` and its states `zzGk4`, T144): where the repo
 * will be, which of the four things starting it there does, and whether a remote can come with it.
 */

/** Why a repo cannot be called `name`, or null when it can: it becomes a folder, and a forge repository. */
export function repoNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name the repository'
  if (trimmed === '.' || trimmed === '..') return `${trimmed} cannot be a folder name`
  if (/[/\\:]/.test(trimmed)) return 'A repository name is one folder: no slashes or colons'
  return null
}

/** The folder a new repo named `name` starts in, inside `location`; null until both are given. */
export function newRepoPath(location: string, name: string): string | null {
  const parent = location.trim().replace(/\/+$/, '')
  if (!parent || repoNameProblem(name)) return null
  return `${parent}/${name.trim()}`
}

export type PlanTone = 'local' | 'in-place' | 'refused'

/** The row under Location: the folder, what starting there does, and its badge. */
export interface PlanLine {
  path: string
  sub: string
  badge: string
  tone: PlanTone
  /** Whether the repo can start there. */
  startable: boolean
}

const FIRST_COMMIT = 'git init on main, one first commit on your git identity'

export function planLine(plan: RepoStartPlan): PlanLine {
  switch (plan.kind) {
    case 'new-folder':
      return {
        path: plan.path,
        sub: `A new, empty folder · ${FIRST_COMMIT}`,
        badge: 'Local only',
        tone: 'local',
        startable: true,
      }
    case 'empty':
      return {
        path: plan.path,
        sub: `An empty folder · ${FIRST_COMMIT}`,
        badge: 'Local only',
        tone: 'local',
        startable: true,
      }
    case 'in-place':
      return {
        path: plan.path,
        sub: `Starts the repo in place · ${plan.files} ${plan.files === 1 ? 'file' : 'files'} kept as they are and committed`,
        badge: 'In place',
        tone: 'in-place',
        startable: true,
      }
    case 'refused':
      return { path: plan.path, sub: plan.reason, badge: 'Can’t start here', tone: 'refused', startable: false }
  }
}

/** The remote row's title and line, for the forge on offer. */
export function remoteLine(offer: RemoteOffer): { title: string; sub: string } {
  const title = `Also create it on ${offer.name}`
  if (!offer.ready) {
    const fix = offer.fix ? `Run ${offer.fix}, then choose this again` : 'Sign its CLI in, then choose this again'
    return { title, sub: `${offer.name} is not ready. ${fix} — or start local and add a remote later.` }
  }
  const under = offer.account ? ` under ${offer.account}` : ''
  return {
    title,
    sub:
      `A private repository${under}, set as origin with the first commit pushed. Leave it off to start local: ` +
      'a repo with no remote works everywhere here, and can get one later.',
  }
}
