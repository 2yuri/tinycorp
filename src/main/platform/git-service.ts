import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  forgeCliMissingReason,
  NO_REMOTE,
  noForgeReason,
  type PullRequestCheck,
  type PullRequestView,
} from '../../shared/code'
import { FORGE_COMMAND, FORGE_LABEL, type Forge, forgeOf, remoteHost } from '../../shared/forges'
import type {
  ForgeAdapter,
  ForgeAdapters,
  ForgeReview,
  ReviewThreadDraft,
  ReviewVerdictOnForge,
} from '../../shared/forges/adapter'
import { ticketBranchStem } from '../../shared/ticket-id'
import { createGitRunner, gitFailure as failure, GitFailure, type GitRunner } from './git-runner'

export type { ForgeReview, ReviewThreadDraft, ReviewVerdictOnForge }

/** A branch's unmerged work, as deleting its ticket asks about it (T275). */
export interface BranchWork {
  /** Commits on the branch that its base does not have. */
  commits: number
  /** The worktree has changes, untracked files included, that nobody committed. */
  uncommitted: boolean
}

/** Files the app writes into a Session's working directory; never committed to a repo. */
export const INJECTED_PATHS = ['CLAUDE.md', '.claude/', 'MEMORY.md', 'memory/'] as const

/**
 * Worktrees and PRs in the Company's real repos.
 *
 * Everything git does is here. Everything a forge does — opening a PR, reading it, commenting on
 * it, merging it — goes through a {@link ForgeAdapter}, chosen per repo from that repo's own
 * `origin`, because a Company can hold repos on several forges at once. This file knows that a PR
 * exists; it does not know whose.
 */
export interface GitService {
  /**
   * Checks out `branch` at `path`, creating the branch from `base` (the repo's default branch when
   * omitted) when it does not exist yet. An existing worktree at `path` is reused. Keeps injected
   * files out of git.
   */
  addWorktree(request: AddWorktree): AddedWorktree
  /**
   * Pushes the worktree's branch to `origin` and asks the repo's forge to open a PR into `base`.
   * A branch that already has one lands on it rather than opening a second.
   */
  openPullRequest(request: OpenPullRequest): Promise<OpenedPullRequest>
  /** Merges a PR through its forge. A PR that is already merged counts as merged. */
  mergePullRequest(request: PullRequestRef): Promise<void>
  /** Comments on a PR through its forge. */
  commentOnPullRequest(request: PullRequestRef & { body: string }): Promise<void>
  /** The PR's CI state, read off the checks its forge reports: `failing` when any check fails. */
  pullRequestChecks(request: PullRequestRef): Promise<CiState>
  /** The PR's size, mergeability and checks, as its forge reports them. */
  pullRequestDetails(request: PullRequestRef): Promise<PullRequestView>
  /** The PR's whole change as a unified patch. */
  pullRequestDiff(request: PullRequestRef): Promise<string>
  /** `git diff base...branch` in the repo itself, for a repo without a remote. */
  branchDiff(request: BranchDiff): Promise<string>
  /**
   * What `rev` resolves to, or null when this checkout has no such revision. `base...branch` means
   * here what it means to `git diff`: where the branch left the base. The review screen's cache is
   * keyed by what comes back, because a patch of a commit is what it is for ever (T243).
   */
  revision(request: { repoPath: string; rev: string }): Promise<string | null>
  /**
   * One file as `ref` has it, or null when that ref has no such path — which is how an added file
   * and a removed one answer for the side they are not on. The two sides are what Monaco's diff
   * editor is given (T243).
   */
  fileAtRef(request: { repoPath: string; ref: string; path: string }): Promise<string | null>
  /**
   * Comments on one line of a PR's head, under the PR's review comments. Answers the comment's
   * URL, or null when the forge gave none.
   */
  commentOnPullRequestLine(request: LineComment): Promise<string | null>
  /**
   * Posts one round of an agent's review on the PR as a single review, with a thread on each line
   * it names, and answers the thread ids the forge gave — one per draft, in order (T170). Null
   * when the repo's forge cannot hold a review conversation, and the app keeps it to itself.
   */
  postReview(request: PostReviewOnPullRequest): Promise<ForgeReview | null>
  /** Replies in a thread this app opened, and answers the reply's URL. Null when the forge cannot. */
  replyInThread(request: ThreadOnPullRequest & { body: string }): Promise<string | null>
  /** Resolves a thread this app opened, where the forge can. Resolving a resolved thread is fine. */
  resolveThread(request: ThreadOnPullRequest): Promise<void>
  /** Whether the repo's forge can hold a review conversation at all: the panel says so when not. */
  canHoldReview(repoPath: string): boolean
  /**
   * Removes a ticket's worktree and deletes its branch locally and, best effort, on `origin`.
   * What is already gone is skipped.
   */
  removeWorktree(request: { repoPath: string; path: string; branch: string }): Promise<void>
  /**
   * What a ticket's worktree holds that no one merged: its branch's commits past `base`, and
   * whether the worktree has changes nobody committed. A worktree or branch that is gone holds none.
   */
  branchWork(request: { repoPath: string; path: string; base: string; branch: string }): Promise<BranchWork>
  /** Whether the repo has an `origin` to push to; without one no PR can be opened. */
  hasRemote(repoPath: string): boolean
  /** The forge the repo's `origin` is on, or null when it has none or is on a host no adapter claims. */
  forgeOf(repoPath: string): Forge | null
  /**
   * Why no PR can be opened for this repo, in one sentence, or null when one can: no `origin`, a
   * forge TinyCorp has no adapter for, or a forge whose CLI is not on this Mac. The app says this
   * up front — in the Employee's instructions, in `#prs` and on the ticket — rather than letting a
   * ticket reach Review and fail there.
   */
  pullRequestRefusal(repoPath: string): string | null
  /**
   * Merges a ticket's `branch` into `base` in the repo itself, for a repo without a remote: where
   * `base` is checked out, else without touching any checkout. Refuses uncommitted changes on the
   * base and aborts a merge with conflicts, leaving the base as it was.
   */
  mergeLocally(request: LocalMerge): Promise<void>
}

/** The change of `branch` since it left `base`, in the repo itself. */
export interface BranchDiff {
  repoPath: string
  base: string
  branch: string
}

/** A comment on one line of a PR's head file. */
export interface LineComment extends PullRequestRef {
  path: string
  /** The line in the head file, as the diff numbers it. */
  line: number
  body: string
}

/** One round of a review, ready for its repo's forge. */
export interface PostReviewOnPullRequest extends PullRequestRef {
  summary: string
  verdict: ReviewVerdictOnForge
  threads: readonly ReviewThreadDraft[]
}

/** A thread on a PR, by the id its forge gave it. */
export interface ThreadOnPullRequest extends PullRequestRef {
  threadId: string
}

export interface LocalMerge {
  repoPath: string
  branch: string
  base: string
}

export { NO_REMOTE } from '../../shared/code'

/** A PR, by URL, acted on from its repo's checkout. */
export interface PullRequestRef {
  repoPath: string
  url: string
}

/** `none` when the PR has no checks. */
export type CiState = 'passing' | 'failing' | 'pending' | 'none'

export interface AddWorktree {
  repoPath: string
  path: string
  branch: string
  /** The branch to start from and open PRs into; `origin`'s copy is preferred over the local one. */
  base?: string
}

export interface AddedWorktree {
  path: string
  branch: string
  /** The branch PRs from this worktree go into. */
  base: string
}

export interface OpenPullRequest {
  /** The worktree to push from. */
  path: string
  branch: string
  base: string
  title: string
  body: string
}

export interface OpenedPullRequest {
  url: string
  /** Null when the URL does not end in a PR number. */
  number: number | null
}

export interface GitServiceOptions {
  /**
   * The one git (T259). Left out, it is a runner with no team runtime — every path is this
   * machine's — which is what a test wants and what a Mac has.
   */
  git?: GitRunner
  /**
   * One adapter per forge, built in `main/forges` and handed in by the composition root. Left out
   * there are none, and a repo on any forge says it can open no pull request — which is what a
   * test that is not about a forge wants, and means no test can reach a forge CLI by accident.
   *
   * It is handed in rather than built here because the machine sits below the forge seam: git
   * knows that a pull request exists, and nothing about whose (T186a).
   */
  forges?: ForgeAdapters
}

/**
 * `ticket-tc-142-<slug>`: the ticket's display id in lowercase (decision 33), then the title in
 * lowercase words joined by `-`, at most 40 characters.
 */
export function branchName(companyKey: string, ticketId: number, title: string): string {
  const stem = ticketBranchStem(companyKey, ticketId)
  const slug = slugify(title)
  return slug ? `${stem}-${slug}` : stem
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** The Git service over the `git` command line, with one forge adapter per catalogued forge. */
export function createGitService({ git = createGitRunner(), forges = {} }: GitServiceOptions = {}): GitService {
  /**
   * Every path git prints comes back in this process's spelling, because the database, the Files
   * view and `realpathSync` all hold Windows paths — and inside a distro git answers `/home/b/…`.
   * It is safe on all of these: each one's whole answer is a path or a list of them.
   */
  const gitSync = (cwd: string, args: string[]): string => git.text(cwd, args, { mapPaths: true }).trim()
  const tryGit = (cwd: string, args: string[]): string | null =>
    git.tryText(cwd, args, { mapPaths: true })?.trim() ?? null

  /** Where new branches start and PRs go: `origin`'s default branch, else the checked-out one. */
  function defaultBranch(repoPath: string): { base: string; startPoint: string } {
    const remote = tryGit(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (remote?.startsWith('origin/')) return { base: remote.slice('origin/'.length), startPoint: remote }
    const current = tryGit(repoPath, ['branch', '--show-current'])
    if (!current) throw new Error(`${repoPath} has no default branch to start from`)
    return { base: current, startPoint: 'HEAD' }
  }

  /** Where new branches start for a chosen base: `origin/<base>` when fetched, else the local branch. */
  function chosenBranch(repoPath: string, base: string): { base: string; startPoint: string } {
    for (const startPoint of [`origin/${base}`, base]) {
      const ref = startPoint === base ? `refs/heads/${base}` : `refs/remotes/${startPoint}`
      if (tryGit(repoPath, ['rev-parse', '--verify', '--quiet', ref]) !== null) return { base, startPoint }
    }
    throw new Error(`${repoPath} has no branch ${base} to start from`)
  }

  function excludeInjected(repoPath: string): void {
    const file = resolve(repoPath, gitSync(repoPath, ['rev-parse', '--git-common-dir']), 'info', 'exclude')
    const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const lines = new Set(current.split('\n'))
    const missing = INJECTED_PATHS.filter((p) => !lines.has(p))
    if (missing.length === 0) return
    mkdirSync(dirname(file), { recursive: true })
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    appendFileSync(file, `${prefix}${missing.join('\n')}\n`)
  }

  function isWorktreeOf(repoPath: string, path: string): boolean {
    const list = tryGit(repoPath, ['worktree', 'list', '--porcelain']) ?? ''
    const wanted = samePathKey(realPath(path))
    return list
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some((line) => samePathKey(realPath(line.slice('worktree '.length))) === wanted)
  }

  /** The checkout where `branch` is checked out, the repo's own or a linked worktree, if any. */
  function checkoutOf(repoPath: string, branch: string): string | null {
    const blocks = (tryGit(repoPath, ['worktree', 'list', '--porcelain']) ?? '').split('\n\n')
    for (const block of blocks) {
      const lines = block.split('\n')
      if (!lines.includes(`branch refs/heads/${branch}`)) continue
      const path = lines.find((line) => line.startsWith('worktree '))
      if (path) return path.slice('worktree '.length)
    }
    return null
  }

  /** A committer for merge commits when the repo has none configured. */
  /**
   * Flags for a commit the app makes itself. Signing is off: the boss's `commit.gpgsign` would ask
   * for a passphrase no window can answer, and a merge must never hang or fail on that.
   */
  function identity(cwd: string): string[] {
    const configured = tryGit(cwd, ['config', 'user.name']) && tryGit(cwd, ['config', 'user.email'])
    const who = configured ? [] : ['-c', 'user.name=TinyCorp', '-c', 'user.email=tinycorp@localhost']
    return [...who, '-c', 'commit.gpgsign=false']
  }

  /** Merges `branch` into what is checked out at `cwd`, aborting on conflicts. */
  function mergeInto(cwd: string, branch: string, base: string): void {
    try {
      git.text(cwd, [...identity(cwd), 'merge', '--no-edit', branch])
    } catch (error) {
      tryGit(cwd, ['merge', '--abort'])
      const output = error instanceof GitFailure ? error.stdout : ''
      const reason = /CONFLICT/.test(output) ? 'the branches conflict' : failure(error)
      throw new Error(`Could not merge ${branch} into ${base}: ${reason}`)
    }
  }

  /** The repo's `origin`, as it is written in its config, or null when it has none. */
  function remoteOf(repoPath: string): string | null {
    return tryGit(repoPath, ['remote', 'get-url', 'origin']) || null
  }

  /** Why this checkout can get no PR, in one sentence, or null when it can. */
  function refusal(repoPath: string): string | null {
    const remote = remoteOf(repoPath)
    if (!remote) return NO_REMOTE
    const forge = forgeOf(remote)
    if (!forge) return noForgeReason(remoteHost(remote) ?? remote)
    const adapter = forges[forge]
    if (!adapter) return noForgeReason(remoteHost(remote) ?? remote)
    if (!adapter.installed()) return forgeCliMissingReason(FORGE_LABEL[forge], FORGE_COMMAND[forge])
    return null
  }

  /**
   * The adapter for this checkout's forge; throws the refusal's own sentence when there is none.
   * Every method that calls it is `async`, so a repo with no adapter rejects rather than throwing
   * at a caller that is waiting on a promise.
   */
  function forgeFor(repoPath: string): ForgeAdapter {
    const remote = remoteOf(repoPath)
    const forge = remote ? forgeOf(remote) : null
    const adapter = forge ? forges[forge] : undefined
    if (!adapter) throw new Error(refusal(repoPath) ?? NO_REMOTE)
    return adapter
  }

  return {
    async mergeLocally({ repoPath, branch, base }) {
      for (const name of [branch, base]) {
        if (tryGit(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) === null) {
          throw new Error(`${repoPath} has no branch ${name}`)
        }
      }
      const checkout = checkoutOf(repoPath, base)
      if (checkout !== null) {
        if (gitSync(checkout, ['status', '--porcelain', '--untracked-files=no']) !== '') {
          throw new Error(`${checkout} has uncommitted changes on ${base}; commit or stash them, then merge again`)
        }
        return mergeInto(checkout, branch, base)
      }
      const before = gitSync(repoPath, ['rev-parse', `refs/heads/${base}`])
      if (tryGit(repoPath, ['merge-base', '--is-ancestor', base, branch]) !== null) {
        gitSync(repoPath, ['update-ref', `refs/heads/${base}`, gitSync(repoPath, ['rev-parse', branch]), before])
        return
      }
      const scratch = mkdtempSync(join(tmpdir(), 'tinycorp-merge-'))
      try {
        gitSync(repoPath, ['worktree', 'add', '--detach', scratch, base])
        mergeInto(scratch, branch, base)
        gitSync(repoPath, ['update-ref', `refs/heads/${base}`, gitSync(scratch, ['rev-parse', 'HEAD']), before])
      } finally {
        tryGit(repoPath, ['worktree', 'remove', '--force', scratch])
        rmSync(scratch, { recursive: true, force: true })
        tryGit(repoPath, ['worktree', 'prune'])
      }
    },

    addWorktree({ repoPath, path, branch, base: chosen }) {
      if (tryGit(repoPath, ['rev-parse', '--git-dir']) === null) {
        throw new Error(`${repoPath} is not a git repo`)
      }
      excludeInjected(repoPath)
      if (chosen !== undefined && existsSync(path) && isWorktreeOf(repoPath, path)) {
        return { path, branch, base: chosen }
      }
      const { base, startPoint } = chosen === undefined ? defaultBranch(repoPath) : chosenBranch(repoPath, chosen)
      if (existsSync(path) && isWorktreeOf(repoPath, path)) return { path, branch, base }
      gitSync(repoPath, ['worktree', 'prune'])
      mkdirSync(dirname(path), { recursive: true })
      const exists = tryGit(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null
      gitSync(
        repoPath,
        exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '--no-track', '-b', branch, path, startPoint],
      )
      return { path, branch, base }
    },

    async openPullRequest({ path, branch, base, title, body }) {
      const forge = forgeFor(path)
      try {
        await git.output(path, ['push', '--set-upstream', 'origin', branch])
      } catch (error) {
        throw new Error(`git push failed: ${failure(error)}`)
      }
      try {
        return await forge.openPullRequest({ cwd: path, branch, base, title, body })
      } catch (error) {
        // A branch that already has a PR is not a failure: every forge refuses a second one in its
        // own words, so the answer is to go and find the one that is there, not to parse the words.
        const existing = await forge.findPullRequest({ cwd: path, branch }).catch(() => null)
        if (!existing) throw error instanceof Error ? error : new Error(String(error))
        return existing
      }
    },

    async mergePullRequest({ repoPath, url }) {
      return forgeFor(repoPath).merge({ cwd: repoPath, url })
    },

    async commentOnPullRequest({ repoPath, url, body }) {
      return forgeFor(repoPath).comment({ cwd: repoPath, url, body })
    },

    async pullRequestChecks({ repoPath, url }) {
      // One read, not two: what the review card draws already carries every check the forge knows.
      const { checks } = await forgeFor(repoPath).readPullRequest({ cwd: repoPath, url })
      return ciStateOf(checks)
    },

    async pullRequestDetails({ repoPath, url }) {
      return forgeFor(repoPath).readPullRequest({ cwd: repoPath, url })
    },

    async pullRequestDiff({ repoPath, url }) {
      return forgeFor(repoPath).readDiff({ cwd: repoPath, url })
    },

    async branchDiff({ repoPath, base, branch }) {
      try {
        // No `mapPaths` here, and nowhere a patch or a file is read: a diff's body is somebody's
        // source code, and rewriting a `/usr/...` in it would change what the boss is reading.
        return await git.output(repoPath, ['diff', '--patch', '--find-renames', `${base}...${branch}`], {
          maxBuffer: DIFF_BUFFER,
        })
      } catch (error) {
        throw new Error(`git diff failed: ${failure(error)}`)
      }
    },

    async revision({ repoPath, rev }) {
      // `base...branch` means here what it means to `git diff`: where the branch left the base. So
      // the two sides Monaco is given are the two sides the file list was counted from.
      const dots = rev.indexOf('...')
      const args =
        dots === -1
          ? ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]
          : ['merge-base', rev.slice(0, dots), rev.slice(dots + 3)]
      try {
        const found = (await git.output(repoPath, args)).trim()
        return found === '' ? null : found
      } catch {
        return null
      }
    },

    async fileAtRef({ repoPath, ref, path }) {
      try {
        // `--textconv` is off and `:path` is git's own pathspec, so a name with a colon or a space
        // in it needs no quoting of ours; a path git has no blob for exits non-zero, which is null.
        return await git.output(repoPath, ['show', `${ref}:${path}`], { maxBuffer: DIFF_BUFFER })
      } catch {
        return null
      }
    },

    async commentOnPullRequestLine({ repoPath, url, path, line, body }) {
      return forgeFor(repoPath).commentOnLine({ cwd: repoPath, url, path, line, body })
    },

    async postReview({ repoPath, url, summary, verdict, threads }) {
      const forge = forgeFor(repoPath)
      if (!forge.postReview) return null
      return forge.postReview({ cwd: repoPath, url, summary, verdict, threads })
    },

    async replyInThread({ repoPath, url, threadId, body }) {
      const forge = forgeFor(repoPath)
      if (!forge.replyToThread) return null
      return forge.replyToThread({ cwd: repoPath, url, threadId, body })
    },

    async resolveThread({ repoPath, url, threadId }) {
      const forge = forgeFor(repoPath)
      if (!forge.resolveThread) return
      await forge.resolveThread({ cwd: repoPath, url, threadId })
    },

    canHoldReview(repoPath) {
      const remote = remoteOf(repoPath)
      const forge = remote ? forgeOf(remote) : null
      const adapter = forge ? forges[forge] : undefined
      return Boolean(adapter?.postReview)
    },

    hasRemote(repoPath) {
      return Boolean(remoteOf(repoPath))
    },

    forgeOf(repoPath) {
      return forgeOf(remoteOf(repoPath))
    },

    pullRequestRefusal(repoPath) {
      return refusal(repoPath)
    },

    async removeWorktree({ repoPath, path, branch }) {
      if (tryGit(repoPath, ['rev-parse', '--git-dir']) === null) {
        throw new Error(`${repoPath} is not a git repo`)
      }
      if (isWorktreeOf(repoPath, path)) gitSync(repoPath, ['worktree', 'remove', '--force', path])
      gitSync(repoPath, ['worktree', 'prune'])
      if (tryGit(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null) {
        gitSync(repoPath, ['branch', '-D', branch])
      }
      try {
        await git.output(repoPath, ['push', 'origin', '--delete', branch])
      } catch {
        // Already deleted on origin, e.g. by the forge after the merge, or origin is unreachable.
      }
    },

    async branchWork({ repoPath, path, base, branch }) {
      // What cannot be read throws rather than reading as nothing: this answer decides whether
      // work is thrown away. The files the app itself writes are in the exclude file, so not work.
      const exists = tryGit(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null
      const commits = exists ? Number.parseInt(gitSync(repoPath, ['rev-list', '--count', `${base}..${branch}`]), 10) : 0
      const uncommitted = isWorktreeOf(repoPath, path) && gitSync(path, ['status', '--porcelain']) !== ''
      return { commits, uncommitted }
    },
  }
}

/** A branch's diff is far larger than a command's default 1MB buffer. */
const DIFF_BUFFER = 64 * 1024 * 1024

/**
 * A PR's CI state, from the checks its forge reported. One read answers both questions the app
 * asks — what the review card draws, and whether CI is red — so no forge is asked twice.
 */
export function ciStateOf(checks: readonly PullRequestCheck[]): CiState {
  if (checks.some((check) => check.state === 'failing')) return 'failing'
  if (checks.some((check) => check.state === 'pending')) return 'pending'
  return checks.length === 0 ? 'none' : 'passing'
}

/**
 * Two paths that name the one folder, as a key that compares. `git worktree list` prints Windows
 * paths with forward slashes and whatever case the repo was created under, while `realpathSync`
 * hands back the drive's own spelling with backslashes: comparing the two as strings said no
 * worktree was ever ours, so one was never reused and never removed (T166).
 */
function samePathKey(path: string): string {
  if (process.platform !== 'win32') return path
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * The one true path of a folder. `realpathSync.native` rather than `realpathSync` because on
 * Windows it is the only one that expands a short `PROGRA~1`-style name, and git always answers
 * with the long one (T166).
 */
function realPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}
