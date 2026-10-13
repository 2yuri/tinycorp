import { type PullRequest, type PullRequestRefusal, refusalOf, type Worktree } from '../../../shared/code'
import { diffFilesOf } from '../../../shared/review/diff-parse'
import type { FileSides, RepoDiff } from '../../../shared/review/review-diff'
import type { GitService } from '../../platform'

/** A repo's refusal as the panel takes it: the badge and the sentence, or null when none. */
function refusalOrNull(reason: string | null): PullRequestRefusal | null {
  return reason === null ? null : refusalOf(reason)
}

/**
 * How long the app trusts what it last worked out a branch's tip to be. Past it `git rev-parse`
 * runs again — a handful of milliseconds — and only a tip that really moved costs a patch.
 */
export const REVIEW_DIFF_TTL_MS = 15_000

/** How many patches and file bodies are kept before the oldest is dropped. */
const CACHE_LIMIT = 64

export interface ReviewDiffReader {
  /**
   * The changed files of each of a ticket's repos, in the order of its worktrees: the PR's patch
   * where there is a PR, else the branch's own diff, read for its file list. Repos whose diff
   * cannot be read are left out.
   */
  read(code: TicketDiffInput, repoPath: (repoId: string) => string | null): Promise<RepoDiff[]>
  /**
   * The two sides of one file of one repo's change, which is what the diff editor draws. Throws
   * with a sentence the pane can show when this checkout cannot answer for the file.
   */
  sides(
    code: TicketDiffInput,
    repoPath: (repoId: string) => string | null,
    request: { repoId: string; path: string },
  ): Promise<FileSides>
}

export interface TicketDiffInput {
  worktrees: Worktree[]
  pullRequests: PullRequest[]
}

export interface ReviewDiffOptions {
  /** Without one, no ticket has a diff. */
  git?: GitService
  log(line: string): void
  now?: () => number
  ttlMs?: number
  /**
   * False keeps nothing at all: every read asks git or the forge again. The security pass reads
   * this way, because the one question that must not be answered out of date is whether the change
   * a round has just started on is worth a pass (T241) — and a commit key cannot tell a patch that
   * arrived late from one that never changed.
   */
  cached?: boolean
}

/**
 * Reads tickets' diffs with `gh` (or `git` for a repo without a remote), and one file's two sides
 * with `git show`.
 *
 * **Keyed by the commit, not by the clock (T243).** A patch is what it is for the commit it is of,
 * so what is cached against a resolved SHA never goes stale and never expires; only the question
 * *which commit is the head* is asked again, on the TTL, and that is one local `rev-parse`. Before
 * this, every review event past fifteen seconds re-ran `gh pr diff` over the network.
 */
export function createReviewDiff({
  git,
  log,
  now = Date.now,
  ttlMs = REVIEW_DIFF_TTL_MS,
  cached = true,
}: ReviewDiffOptions): ReviewDiffReader {
  /** What a revision last resolved to, for `ttlMs`; the one thing here that can go out of date. */
  const heads = new Map<string, { at: number; sha: Promise<string | null> }>()
  /** Patches and file bodies, by the commits they are of. Nothing in here can be wrong. */
  const byCommit = new Map<string, Promise<string>>()

  function commit(repoPath: string, rev: string): Promise<string | null> {
    const key = `${repoPath}#${rev}`
    const known = heads.get(key)
    if (cached && known && now() - known.at < ttlMs) return known.sha
    const fresh = git ? git.revision({ repoPath, rev }) : Promise.resolve(null)
    heads.set(key, { at: now(), sha: fresh })
    fresh.catch(() => heads.delete(key))
    return fresh
  }

  /** Cached against a key that names the commits it is of, so it is never asked for twice. */
  function kept(key: string, read: () => Promise<string>): Promise<string> {
    if (!cached) return read()
    const known = byCommit.get(key)
    if (known) return known
    const fresh = read()
    byCommit.set(key, fresh)
    if (byCommit.size > CACHE_LIMIT) byCommit.delete(byCommit.keys().next().value!)
    fresh.catch(() => {
      if (byCommit.get(key) === fresh) byCommit.delete(key)
    })
    return fresh
  }

  /** The repos a ticket's change touches, worktrees first, then any PR without one left. */
  function repoIdsOf({ worktrees, pullRequests }: TicketDiffInput): string[] {
    return [
      ...worktrees.map((w) => w.repoId),
      ...pullRequests.filter((p) => !worktrees.some((w) => w.repoId === p.repoId)).map((p) => p.repoId),
    ]
  }

  async function read(code: TicketDiffInput, repoPath: (repoId: string) => string | null): Promise<RepoDiff[]> {
    if (!git) return []
    const service = git
    const found = await Promise.all(
      repoIdsOf(code).map(async (repoId): Promise<RepoDiff | null> => {
        const path = repoPath(repoId)
        if (path === null) return null
        const worktree = code.worktrees.find((w) => w.repoId === repoId)
        const pr = code.pullRequests.find((p) => p.repoId === repoId)
        if (!pr && !worktree) return null
        const span = worktree ? `${worktree.base}...${worktree.branch}` : ''
        try {
          // The head's SHA where there is a branch to resolve. A PR whose worktree has been
          // cleaned up has no commit to name here, so its patch goes on expiring on the clock.
          const head = worktree ? await commit(path, worktree.branch) : `at ${now() - (now() % ttlMs)}`
          const key = `${pr ? pr.url : path}#${head}#${span}`
          const text = await kept(key, () =>
            pr
              ? service.pullRequestDiff({ repoPath: path, url: pr.url })
              : service.branchDiff({ repoPath: path, base: worktree!.base, branch: worktree!.branch }),
          )
          return {
            repoId,
            url: pr?.url ?? null,
            refusal: refusalOrNull(service.pullRequestRefusal(path)),
            head: worktree?.branch ?? '',
            base: worktree?.base ?? '',
            files: diffFilesOf(text),
          }
        } catch (error) {
          log(`Could not read the diff of ${pr?.url ?? `${path} ${span}`}: ${message(error)}`)
          return null
        }
      }),
    )
    return found.filter((d): d is RepoDiff => d !== null)
  }

  return {
    read,

    async sides(code, repoPath, { repoId, path }) {
      if (!git) throw new Error('This machine has no git to read the change with.')
      const service = git
      const folder = repoPath(repoId)
      const worktree = code.worktrees.find((w) => w.repoId === repoId)
      if (folder === null) throw new Error('That repository is no longer in this Company.')
      // Only a checkout can answer for a file's two sides. A PR whose worktree has been cleaned up
      // still lists its files; reading one of them is the forge's job from then on.
      if (!worktree) throw new Error('This pull request has no worktree here any more; open it on the forge.')
      const list = await read(code, repoPath)
      const file = list.find((repo) => repo.repoId === repoId)?.files.find((one) => one.path === path)
      if (!file) throw new Error(`Nothing in this change touches ${path}.`)
      if (file.binary) return { path, original: '', modified: '', binary: true }
      const [base, head] = await Promise.all([
        commit(folder, `${worktree.base}...${worktree.branch}`),
        commit(folder, worktree.branch),
      ])
      if (base === null || head === null) throw new Error('This branch and its base do not meet in this checkout.')
      const at = (ref: string, which: string) =>
        kept(
          `${folder}#${ref}#${which}`,
          async () => (await service.fileAtRef({ repoPath: folder, ref, path: which })) ?? '',
        )
      const [original, modified] = await Promise.all([
        file.status === 'added' ? Promise.resolve('') : at(base, file.previousPath ?? path),
        file.status === 'removed' ? Promise.resolve('') : at(head, path),
      ])
      return { path, original, modified, binary: false }
    },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
