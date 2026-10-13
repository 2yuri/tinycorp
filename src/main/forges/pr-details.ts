import type { PullRequest, PullRequestDetails, PullRequestView } from '../../shared/code'
import type { GitService } from '../platform'

/** How long what a forge said about a PR is reused before asking again. */
export const PR_DETAILS_TTL_MS = 30_000

export interface PullRequestDetailsReader {
  /** What the forge says about each of `pullRequests`, in order; PRs it cannot read are left out. */
  read(pullRequests: PullRequest[], repoPath: (repoId: string) => string | null): Promise<PullRequestDetails[]>
}

export interface PullRequestDetailsOptions {
  /** Without one, no PR has details. */
  git?: GitService
  log(line: string): void
  now?: () => number
  ttlMs?: number
}

/** Reads PR details through each repo's forge, keeping each answer for `ttlMs` so renders never hit one. */
export function createPullRequestDetails({
  git,
  log,
  now = Date.now,
  ttlMs = PR_DETAILS_TTL_MS,
}: PullRequestDetailsOptions): PullRequestDetailsReader {
  const cache = new Map<string, { at: number; view: Promise<PullRequestView> }>()

  function view(repoPath: string, url: string): Promise<PullRequestView> {
    const cached = cache.get(url)
    if (cached && now() - cached.at < ttlMs) return cached.view
    const fresh = git!.pullRequestDetails({ repoPath, url })
    cache.set(url, { at: now(), view: fresh })
    fresh.catch(() => {
      if (cache.get(url)?.view === fresh) cache.delete(url)
    })
    return fresh
  }

  return {
    async read(pullRequests, repoPath) {
      if (!git) return []
      const read = await Promise.all(
        pullRequests.map(async (pr): Promise<PullRequestDetails | null> => {
          const path = repoPath(pr.repoId)
          if (path === null) return null
          try {
            const details = await view(path, pr.url)
            return { ...details, ticketId: pr.ticketId, repoId: pr.repoId, url: pr.url, number: pr.number }
          } catch (error) {
            log(`Could not read ${pr.url}: ${error instanceof Error ? error.message : String(error)}`)
            return null
          }
        }),
      )
      return read.filter((d): d is PullRequestDetails => d !== null)
    },
  }
}
