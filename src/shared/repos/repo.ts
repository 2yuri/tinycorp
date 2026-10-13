/**
 * A repo's detected facts (language, framework, package manager) and its optional Checks
 * (install, build, test, lint), decision 40. Nothing here gates work.
 * Every field is text; an empty string means not set yet.
 */
export interface StackConstraints {
  language: string
  framework: string
  packageManager: string
  /** Free text such as `9` or `9.12.0`; shown next to the package manager. */
  packageManagerVersion: string
  /** Checks: commands every Employee runs inside the worktree before opening a PR, once set. */
  install: string
  build: string
  test: string
  lint: string
}

export const STACK_KEYS = [
  'language',
  'framework',
  'packageManager',
  'packageManagerVersion',
  'install',
  'build',
  'test',
  'lint',
] as const satisfies readonly (keyof StackConstraints)[]

/** The Checks: commands run before every PR once they exist. */
export const CHECK_KEYS = ['install', 'build', 'test', 'lint'] as const satisfies readonly (keyof StackConstraints)[]

export const EMPTY_STACK: StackConstraints = {
  language: '',
  framework: '',
  packageManager: '',
  packageManagerVersion: '',
  install: '',
  build: '',
  test: '',
  lint: '',
}

/**
 * Whether a repo has at least one Check. Without any it shows the soft "No checks yet" hint;
 * it is claimable either way (decision 40).
 */
export function hasChecks(stack: Partial<StackConstraints>): boolean {
  return CHECK_KEYS.some((key) => (stack[key] ?? '').trim() !== '')
}

/** Placeholder of every Brief field. */
export const BRIEF_PLACEHOLDER = 'What is this repo? Any stack preferences, or let the team decide.'

/** What an Employee is told about a repo without Checks. */
export const NO_CHECKS_LINE = 'No checks yet: if you set this project up, record its commands with `repo_set_checks`.'

/**
 * What TinyCorp may do to a repo (decision 61). Three rungs, each a superset of the last:
 * `local` never pushes, `pr` pushes a branch and opens a PR but never merges, `merge` may merge.
 * It composes with the Company's autonomy level rather than replacing it: autonomy says when the
 * boss is asked, the repo says what is possible at all, and the repo wins.
 */
export const REPO_RUNGS = ['local', 'pr', 'merge'] as const
export type RepoRung = (typeof REPO_RUNGS)[number]

/** A newly attached repo may merge, so nothing changes for a Company that never touches this. */
export const DEFAULT_RUNG: RepoRung = 'merge'

/** How each rung is named everywhere: the chip, the picker, the refusals and the instructions. */
export const RUNG_LABEL: Record<RepoRung, string> = {
  local: 'local only',
  pr: 'PR only',
  merge: 'merges',
}

/** What each rung allows, in one line, for the picker. */
export const RUNG_HELP: Record<RepoRung, string> = {
  local: 'Never pushes. Work stays in the worktree and you take it from there.',
  pr: 'Pushes a branch and opens a PR, never merges.',
  merge: 'May merge, subject to the Company\u2019s autonomy level.',
}

export function isRepoRung(value: unknown): value is RepoRung {
  return REPO_RUNGS.includes(value as RepoRung)
}

/** Whether the rung lets TinyCorp push a branch and open a PR. */
export function mayPush(rung: RepoRung): boolean {
  return rung !== 'local'
}

/** Whether the rung lets TinyCorp merge at all. Autonomy still decides when it asks first. */
export function mayMerge(rung: RepoRung): boolean {
  return rung === 'merge'
}

/**
 * Why a repo refuses a push or a merge, naming the repo and its rung, or null when it allows it.
 * The engine, the MCP tools and the UI all say this one sentence.
 */
export function rungRefusal(repoName: string, rung: RepoRung, action: 'push' | 'merge'): string | null {
  if (action === 'push' ? mayPush(rung) : mayMerge(rung)) return null
  const what =
    rung === 'local'
      ? 'TinyCorp never pushes or merges there; the work stays in its worktree and the boss takes it from there.'
      : 'TinyCorp opens the PR and never merges it; the PR stays open for someone with the rights to merge it.'
  return `${repoName} is ${RUNG_LABEL[rung]}. ${what}`
}

/** A git repo attached to a Company. */
export interface Repo {
  id: string
  /** Short unique name within the Company, used to refer to the repo. */
  name: string
  /** Absolute path of the repo's checkout. */
  path: string
  /** "About this repo": free text written into every Employee's instructions; empty when not given. */
  brief: string
  stack: StackConstraints
  /** What TinyCorp may do to it; `merge` unless the boss says otherwise. */
  rung: RepoRung
  addedAt: string
}

export interface AddRepoInput {
  path: string
  /** Defaults to the last segment of `path`. */
  name?: string
  brief?: string
  /** Omitted fields stay empty; Checks are optional. */
  stack?: Partial<StackConstraints>
  /** What TinyCorp may do here; `merge` when it is not given. */
  rung?: RepoRung
}

export interface UpdateRepoInput {
  name?: string
  brief?: string
  stack?: Partial<StackConstraints>
  rung?: RepoRung
}

/**
 * What git and the files in a checkout say about it, read live and never stored.
 * Every part is null when it cannot be read.
 */
export interface RepoInspection {
  path: string
  isGitRepo: boolean
  /** The `origin` url as shown: `github.com/owner/name` for GitHub, else the raw url. */
  remote: string | null
  /** The branch `origin/HEAD` points to, else the checked-out branch. */
  defaultBranch: string | null
  commitCount: number | null
  /** ISO time of the last commit on the default branch. */
  lastCommitAt: string | null
  /** Stack fields found in lockfiles and package.json; only the fields that were found. */
  detected: Partial<StackConstraints>
}

/**
 * What starting a repo in a folder would do, read before anything on disk changes, so the panel
 * says which it is doing (T144). Nothing is scaffolded in any of them: the repo holds what the
 * folder holds, and a first commit.
 */
export type RepoStartPlan =
  /** The folder does not exist yet: it is created, empty, and the repo starts in it. */
  | { kind: 'new-folder'; path: string }
  /** The folder exists and holds nothing. */
  | { kind: 'empty'; path: string }
  /** The folder holds files and is not a repo: the repo starts in place, and they are kept and committed. */
  | { kind: 'in-place'; path: string; files: number }
  /** No repo can start here, and why. */
  | { kind: 'refused'; path: string; reason: string }

/** Who can see a repository created on a forge. */
export type RemoteVisibility = 'private' | 'public'

/** A forge the app can create a remote on, and whether its CLI is ready to. */
export interface RemoteOffer {
  /** The forge, as the catalogue names it. */
  forge: string
  /** What the boss calls it. */
  name: string
  /** Whether its CLI is installed and signed in. */
  ready: boolean
  /** The account the CLI is signed in as; the repository is created under it. */
  account: string | null
  /** When not ready, what to run to fix it, in the forge's own words. */
  fix: string | null
}

/** A repository to create on a forge for a repo that has no remote yet. */
export interface NewRemote {
  forge: string
  /** Its name on the forge. */
  name: string
  visibility: RemoteVisibility
}

/** What attaching several scanned checkouts did: the repos added and why the others were not. */
export interface AttachScannedResult {
  attached: Repo[]
  failed: { path: string; error: string }[]
}

/** A folder as the Launcher's Create step sees it before attaching it as a repo. */
export interface DetectedRepo {
  path: string
  gitRepo: boolean
  /** The stack the folder's files declare, or null when nothing was recognised. */
  stack: Partial<StackConstraints> | null
  /** Install, build, test and lint commands found, in that order. */
  commands: string[]
}

/** The checkouts next to a Company's first repo that are not connected yet, for the setup wizard. */
export interface NearbyRepos {
  /** The folder that was scanned: the first repo's parent, or the Company folder when none is connected. */
  folder: string
  found: RepoInspection[]
}
