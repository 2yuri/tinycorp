import type { DatabaseSync } from 'node:sqlite'
import type { Repo } from '../../../shared/repos/repo'
import type { CompanyContext, OpenCompany } from '../../core'
import { type ActivityContext, recordingRepos } from '../activity'
import type { ReposFacade } from './facade'
import { createRepoRegistry, type IsGitRepo, isGitRepoOnDisk, type RepoRegistry } from './repos'

/** What the boss's app hands in, and a test leaves out. */
export interface ReposOptions {
  /** Tells whether a folder is a git checkout; a repo that is not one is refused. */
  isGitRepo?: IsGitRepo
}

export interface ReposDeps extends ReposOptions {
  /** Where the current Company puts a repo's ticket worktrees (T113); the code flow decides. */
  worktreeRootOf(repo: Repo): string
  /** An Employee changed a repo's Checks, in any open Company. */
  onRepoChecksSet(listener: () => void): () => void
  /** How the current Company's activity log names who acted, so an added repo is recorded. */
  activity(): ActivityContext
  /**
   * A repo added over a folder that holds a Company's own data must not track it (decision 45).
   * The rule is `core`'s, because chat, code and testing all name it too, so the feature is handed
   * the decorator rather than reaching past its own layer for it.
   */
  ignoringCompanyData(registry: RepoRegistry): RepoRegistry
}

/** The repos feature, once it is wired. */
export interface ReposFeature {
  facade: Pick<ReposFacade, 'repos' | 'worktreeRootOf' | 'onRepoChecksSet'>
  /** The current Company's repos, recorded in its log and kept off its own data folder. */
  repos: RepoRegistry
  /** One open Company's own repos, plain: the rows, with none of the decoration above. */
  of(entry: OpenCompany): RepoRegistry
}

/**
 * Wires the Company's attached repos to the Companies the app has open (T187).
 *
 * Nothing is cached per Company: a registry is a handful of `SELECT`s over rows an MCP call or
 * another window may have written a moment ago. What the *current* Company's registry has that
 * the others do not is the two decorators — an added repo goes in the activity log, and a repo
 * added over a Company folder is told to ignore that Company's data. Both only ever fire on the
 * Company the boss is looking at, because that is the only one anything adds a repo to.
 * The composition root registers it against the shared Company context.
 */
export function register(ctx: CompanyContext, deps: ReposDeps): ReposFeature {
  const registry = (database: () => DatabaseSync) =>
    createRepoRegistry({ database, isGitRepo: deps.isGitRepo ?? isGitRepoOnDisk })

  const repos = recordingRepos(deps.ignoringCompanyData(registry(() => ctx.currentEntry().db)), deps.activity)

  return {
    of: (entry) => registry(() => entry.db),
    repos,
    facade: { repos, worktreeRootOf: deps.worktreeRootOf, onRepoChecksSet: deps.onRepoChecksSet },
  }
}
