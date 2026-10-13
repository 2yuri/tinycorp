import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { RepoInspection, RepoStartPlan, StackConstraints } from '../../../shared/repos/repo'
import { ignoreCompanyData } from '../../core'
import { createGitRunner, type GitRunner } from '../../platform'
import { createRepoInspector, detectStack, diskInspectorDeps, type InspectRepo } from './repo-inspector'

/** The branch a new repository starts on. */
export const INITIAL_BRANCH = 'main'

export const INITIAL_COMMIT_MESSAGE = 'Initial commit'

export interface InitialiseOptions {
  /**
   * The boss's name, for a Mac where git has no `user.name` yet. The first commit is the boss's on
   * their own git identity (T144); this only fills the gap git would otherwise refuse the commit
   * over, so starting a repo never sends the boss to a terminal to run `git config`.
   */
  author: string
  /** The one git (T259): a repo started inside a distro is made by the distro's own git. */
  git?: GitRunner
  inspect?: InspectRepo
  /** The folders of known Companies; their data is ignored when it would land in the repo (decision 45). */
  companyFolders?: string[]
}

/**
 * What starting a repo at `path` would do, without touching anything: create the folder, start in
 * an empty one, start in place among the files already there, or refuse and say why.
 */
export function planRepoStart(path: string, { git = createGitRunner() }: { git?: GitRunner } = {}): RepoStartPlan {
  if (!isAbsolute(path)) return { kind: 'refused', path, reason: `A repo path must be absolute: ${path}` }
  const folder = resolve(path)
  const refused = (reason: string): RepoStartPlan => ({ kind: 'refused', path: folder, reason })
  const exists = existsSync(folder)
  if (exists && !isFolder(folder)) return refused(`${folder} is a file, not a folder`)
  if (!exists && !isFolder(dirname(folder))) return refused(`${dirname(folder)} does not exist`)
  if (exists && existsSync(join(folder, '.git'))) {
    return refused(`${folder} is already a git repository — attach it as a local folder instead`)
  }
  const outer = repoContaining(exists ? folder : dirname(folder), git)
  if (outer) {
    return refused(
      `${folder} is inside the repository at ${outer}. A repo started there would sit in that one's worktree, ` +
        'and both would track its files — choose a folder outside it',
    )
  }
  if (!exists) return { kind: 'new-folder', path: folder }
  const files = readdirSync(folder).length
  return files === 0 ? { kind: 'empty', path: folder } : { kind: 'in-place', path: folder, files }
}

/**
 * Starts a repository at `path`: creates the folder when it does not exist yet, runs `git init` on
 * `main`, writes a `.gitignore` for the detected stack when the folder already holds a stack and no
 * `.gitignore`, and makes an `Initial commit` on the boss's own git identity holding what the folder
 * has. Nothing is scaffolded and no remote is added. Refuses whatever {@link planRepoStart} refuses.
 * Returns the new repo as the inspector reads it.
 */
export function initialiseRepo(
  path: string,
  { author, git = createGitRunner(), inspect = createRepoInspector(), companyFolders = [] }: InitialiseOptions,
): RepoInspection {
  const plan = planRepoStart(path, { git })
  if (plan.kind === 'refused') throw new Error(plan.reason)
  const folder = plan.path
  if (plan.kind === 'new-folder') mkdirSync(folder)

  const files = new Set(readdirSync(folder))
  const ignore = gitignoreFor(detectStack(folder, files, diskInspectorDeps))
  if (ignore && !files.has('.gitignore')) writeFileSync(join(folder, '.gitignore'), ignore)
  ignoreCompanyData(folder, companyFolders)

  const run = (args: string[], env: NodeJS.ProcessEnv = {}) => {
    try {
      return git.text(folder, args, { env }).trim()
    } catch (error) {
      throw new Error(`Could not initialise ${folder}: ${failure(error)}`)
    }
  }
  run(['init', '--quiet'])
  run(['symbolic-ref', 'HEAD', `refs/heads/${INITIAL_BRANCH}`])
  run(['add', '--all'])
  run(
    ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', INITIAL_COMMIT_MESSAGE],
    missingIdentity(git, folder, author),
  )
  return inspect(folder)
}

/** A `.gitignore` for the stack's language, or null when no stack was detected. */
export function gitignoreFor(stack: Partial<StackConstraints>): string | null {
  const common = ['.DS_Store', '.env', '.env.*', '!.env.example', '*.log']
  const byLanguage: Record<string, string[]> = {
    TypeScript: NODE_IGNORES,
    JavaScript: NODE_IGNORES,
    Go: ['/bin/', '*.exe', '*.test', '*.out', 'vendor/'],
    Rust: ['/target/', '**/*.rs.bk'],
  }
  const specific = stack.language ? byLanguage[stack.language] : undefined
  if (!specific) return null
  return [...specific, '', ...common, ''].join('\n')
}

const NODE_IGNORES = ['node_modules/', 'dist/', 'build/', 'out/', 'coverage/', '.next/', '.turbo/', '*.tsbuildinfo']

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * The identity git lacks, as the environment that fills it in — and nothing for a Mac where git has
 * both a name and an email, so the commit is exactly what `git commit` in a terminal would make.
 */
function missingIdentity(git: GitRunner, cwd: string, author: string): NodeJS.ProcessEnv {
  const name = configured(git, cwd, 'user.name')
  const email = configured(git, cwd, 'user.email')
  if (name && email) return {}
  const fallbackName = name ?? (author.trim() || userInfo().username)
  const fallbackEmail = email ?? `${userInfo().username}@localhost`
  return {
    GIT_AUTHOR_NAME: fallbackName,
    GIT_AUTHOR_EMAIL: fallbackEmail,
    GIT_COMMITTER_NAME: fallbackName,
    GIT_COMMITTER_EMAIL: fallbackEmail,
  }
}

function configured(git: GitRunner, cwd: string, key: string): string | null {
  return git.tryText(cwd, ['config', key])?.trim() || null
}

/** The top of the repository whose worktree holds `folder`, or null when none does. */
function repoContaining(folder: string, git: GitRunner): string | null {
  // git answers with forward slashes on every platform, and inside a distro with a Linux path; the
  // boss reads this sentence, and the folder in it has to be spelled the way their own file manager
  // spells it (T166, T259).
  const top = git.tryText(folder, ['rev-parse', '--show-toplevel'], { mapPaths: true })?.trim()
  return top ? resolve(top) : null
}

function failure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr : ''
  return text.trim() || (error instanceof Error ? error.message : String(error))
}
