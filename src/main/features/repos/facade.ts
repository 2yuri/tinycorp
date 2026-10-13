import type { Repo } from '../../../shared/repos/repo'
import type { CurrentCompany } from '../company'
import type { RepoRegistry } from './repos'

/** The Repositories screen's face on the engine (T188). */
export interface ReposFacade extends CurrentCompany {
  /** Git repos attached to the current Company. */
  repos: RepoRegistry
  /**
   * Where the current Company puts this repo's ticket worktrees (T113). The answer is the code
   * flow's — it is where a worktree is made — and the Repositories screen shows it beside the repo,
   * so the engine answers it rather than either feature naming the other.
   */
  worktreeRootOf(repo: Repo): string
  /** Called after an Employee changes a repo's Checks, in any open Company. */
  onRepoChecksSet(listener: () => void): () => void
}
