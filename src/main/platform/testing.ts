/**
 * `platform`'s test kit: a git service that records what it was asked and answers what the test
 * set up, so a test about worktrees or pull requests needs no repo on disk and no `gh`.
 *
 * It is not part of `platform/index.ts`. A fake is named as this file, by a test or by the
 * end-to-end build, rather than carried into the graph of everything that wants a real git.
 */

import { NO_REMOTE, noForgeReason, type PullRequestView } from '../../shared/code'
import type { Forge } from '../../shared/forges'
import type {
  AddedWorktree,
  AddWorktree,
  BranchDiff,
  BranchWork,
  CiState,
  GitService,
  LineComment,
  LocalMerge,
  OpenedPullRequest,
  OpenPullRequest,
  PostReviewOnPullRequest,
  PullRequestRef,
  ThreadOnPullRequest,
} from './git-service'

export interface FakeGit extends GitService {
  /** Every worktree added, in order. */
  worktrees: AddWorktree[]
  /** Every PR asked for, in order, whether it opened or failed. */
  pullRequests: OpenPullRequest[]
  /** Every PR URL asked to merge, in order, whether it merged or failed. */
  merges: PullRequestRef[]
  /** Every PR comment posted, in order. */
  comments: (PullRequestRef & { body: string })[]
  /** Every local merge asked for, in order, whether it merged or failed. */
  localMerges: LocalMerge[]
  /** Makes the next local merge of `branch` fail with `message`. */
  failLocalMerge(branch: string, message: string): void
  /** Every worktree removed, in order. */
  removed: { repoPath: string; path: string; branch: string }[]
  /** Makes the next `addWorktree` for `repoPath` throw `message`. */
  failWorktree(repoPath: string, message: string): void
  /** Puts unmerged work in the worktree at `path`, for `branchWork` to find; every worktree is clean otherwise. */
  setBranchWork(path: string, work: Partial<BranchWork>): void
  /** Makes every `openPullRequest` from a worktree whose path starts with `pathPrefix` fail with `message`. */
  failPullRequest(pathPrefix: string, message: string): void
  /** Makes merging the PR at `url` fail with `message` until `clearMergeFailure`, or only `times` times. */
  failMerge(url: string, message: string, times?: number): void
  clearMergeFailure(url: string): void
  /** Sets the CI state of the PR at `url`; `passing` otherwise. */
  setChecks(url: string, state: CiState): void
  /** Every PR asked about with `pullRequestDetails`, in order. */
  detailsRead: PullRequestRef[]
  /** Sets what `pullRequestDetails` says about the PR at `url`; an open PR with no checks otherwise. */
  setDetails(url: string, details: Partial<PullRequestView>): void
  /** Makes `pullRequestDetails` of the PR at `url` fail with `message`. */
  failDetails(url: string, message: string): void
  /** Makes the repo at `repoPath` have no `origin`; every repo has one otherwise. */
  withoutRemote(repoPath: string): void
  /**
   * Puts the repo at `repoPath` on a forge TinyCorp has no adapter for, named by `host`. It keeps
   * its remote and everything local; it can open no PR, and says why.
   */
  withoutForge(repoPath: string, host?: string): void
  /** Every PR asked for a patch with `pullRequestDiff`, in order. */
  diffsRead: PullRequestRef[]
  /** Every branch diff asked for, in order. */
  branchDiffs: BranchDiff[]
  /** Sets the patch `pullRequestDiff` answers for the PR at `url`; an empty patch otherwise. */
  setDiff(url: string, patch: string): void
  /** Makes `pullRequestDiff` of the PR at `url` fail with `message`. */
  failDiff(url: string, message: string): void
  /** Sets the patch `branchDiff` answers for `branch`; an empty patch otherwise. */
  setBranchDiff(branch: string, patch: string): void
  /**
   * What `revision` answers for `rev` in every checkout. The review screen's cache is keyed by it,
   * so moving it is how a test says the branch has been pushed to (T243).
   */
  setRevision(rev: string, sha: string): void
  /** What `fileAtRef` answers for `<ref>:<path>`; null for a ref that has no such file. */
  setFileAtRef(ref: string, path: string, text: string): void
  /** Every file read with `fileAtRef`, in order. */
  filesRead: { ref: string; path: string }[]
  /** Every line comment posted, in order. */
  lineComments: LineComment[]
  /** Makes the next line comment on the PR at `url` fail with `message`. */
  failLineComment(url: string, message: string): void
  /** Every review round posted, in order. */
  reviews: PostReviewOnPullRequest[]
  /** Every reply posted in a thread, in order. */
  threadReplies: (ThreadOnPullRequest & { body: string })[]
  /** Every thread resolved on a forge, in order. */
  resolvedThreads: ThreadOnPullRequest[]
  /** Makes the repo at `repoPath` a repo whose forge cannot hold a review conversation. */
  withoutReviews(repoPath: string): void
  /** Makes the next review round on the PR at `url` fail with `message`. */
  failReview(url: string, message: string): void
}

/** A GitService for tests: records worktrees and PRs, and opens PRs numbered from 1. */
export function fakeGit({ base = 'main' }: { base?: string } = {}): FakeGit {
  const worktreeFailures = new Map<string, string>()
  const branchWork = new Map<string, Partial<BranchWork>>()
  const prFailures = new Map<string, string>()
  const mergeFailures = new Map<string, string>()
  const mergeFailuresLeft = new Map<string, number>()
  const checks = new Map<string, CiState>()
  const details = new Map<string, Partial<PullRequestView>>()
  const detailFailures = new Map<string, string>()
  const noRemote = new Set<string>()
  const noForge = new Map<string, string>()
  const localMergeFailures = new Map<string, string>()
  const diffs = new Map<string, string>()
  const diffFailures = new Map<string, string>()
  const branchDiffs = new Map<string, string>()
  const revisions = new Map<string, string>()
  const blobs = new Map<string, string>()
  const lineCommentFailures = new Map<string, string>()
  const reviewFailures = new Map<string, string>()
  const noReviews = new Set<string>()
  let nextThread = 1
  let next = 1
  const fake: FakeGit = {
    worktrees: [],
    pullRequests: [],
    merges: [],
    comments: [],
    removed: [],
    localMerges: [],
    detailsRead: [],
    diffsRead: [],
    branchDiffs: [],
    filesRead: [],
    lineComments: [],
    reviews: [],
    threadReplies: [],
    resolvedThreads: [],
    withoutReviews(repoPath) {
      noReviews.add(repoPath)
    },
    failReview(url, message) {
      reviewFailures.set(url, message)
    },
    async postReview(request) {
      await Promise.resolve()
      if (noReviews.has(request.repoPath)) return null
      const failure = reviewFailures.get(request.url)
      if (failure !== undefined) {
        reviewFailures.delete(request.url)
        throw new Error(failure)
      }
      fake.reviews.push(request)
      return {
        url: `${request.url}#pullrequestreview-${fake.reviews.length}`,
        threads: request.threads.map(() => {
          const id = nextThread++
          return { id: String(id), url: `${request.url}#discussion_r${id}` }
        }),
      }
    },
    async replyInThread(request) {
      await Promise.resolve()
      if (noReviews.has(request.repoPath)) return null
      fake.threadReplies.push(request)
      return `${request.url}#discussion_r${request.threadId}`
    },
    async resolveThread(request) {
      await Promise.resolve()
      if (noReviews.has(request.repoPath)) return
      fake.resolvedThreads.push(request)
    },
    canHoldReview(repoPath) {
      return !noReviews.has(repoPath) && !noRemote.has(repoPath) && !noForge.has(repoPath)
    },
    setDiff(url, patch) {
      diffs.set(url, patch)
    },
    failDiff(url, message) {
      diffFailures.set(url, message)
    },
    setBranchDiff(branch, patch) {
      branchDiffs.set(branch, patch)
    },
    setRevision(rev, sha) {
      revisions.set(rev, sha)
    },
    setFileAtRef(ref, path, text) {
      blobs.set(`${ref}:${path}`, text)
    },
    async revision({ rev }) {
      await Promise.resolve()
      // A rev nothing has moved answers for itself, so a fake checkout still has a stable head.
      return revisions.get(rev) ?? `sha-of-${rev}`
    },
    async fileAtRef({ ref, path }) {
      fake.filesRead.push({ ref, path })
      await Promise.resolve()
      return blobs.get(`${ref}:${path}`) ?? null
    },
    failLineComment(url, message) {
      lineCommentFailures.set(url, message)
    },
    async pullRequestDiff(request) {
      fake.diffsRead.push(request)
      await Promise.resolve()
      const failure = diffFailures.get(request.url)
      if (failure !== undefined) throw new Error(failure)
      return diffs.get(request.url) ?? ''
    },
    async branchDiff(request) {
      fake.branchDiffs.push(request)
      await Promise.resolve()
      return branchDiffs.get(request.branch) ?? ''
    },
    async commentOnPullRequestLine(request) {
      fake.lineComments.push(request)
      await Promise.resolve()
      const failure = lineCommentFailures.get(request.url)
      if (failure !== undefined) {
        lineCommentFailures.delete(request.url)
        throw new Error(failure)
      }
      return `${request.url}#discussion_r${fake.lineComments.length}`
    },
    failLocalMerge(branch, message) {
      localMergeFailures.set(branch, message)
    },
    async mergeLocally(request) {
      fake.localMerges.push(request)
      await Promise.resolve()
      const failure = localMergeFailures.get(request.branch)
      localMergeFailures.delete(request.branch)
      if (failure !== undefined) throw new Error(failure)
    },
    setDetails(url, view) {
      details.set(url, view)
    },
    failDetails(url, message) {
      detailFailures.set(url, message)
    },
    withoutRemote(repoPath) {
      noRemote.add(repoPath)
    },
    withoutForge(repoPath, host = 'gitlab.example.com') {
      noForge.set(repoPath, host)
    },
    hasRemote(repoPath) {
      return !noRemote.has(repoPath)
    },
    forgeOf(repoPath) {
      return noRemote.has(repoPath) || noForge.has(repoPath) ? null : ('github' as Forge)
    },
    pullRequestRefusal(repoPath) {
      if (noRemote.has(repoPath)) return NO_REMOTE
      const host = noForge.get(repoPath)
      return host === undefined ? null : noForgeReason(host)
    },
    failWorktree(repoPath, message) {
      worktreeFailures.set(repoPath, message)
    },
    setBranchWork(path, work) {
      branchWork.set(path, work)
    },
    failPullRequest(pathPrefix, message) {
      prFailures.set(pathPrefix, message)
    },
    failMerge(url, message, times = Number.POSITIVE_INFINITY) {
      mergeFailures.set(url, message)
      mergeFailuresLeft.set(url, times)
    },
    clearMergeFailure(url) {
      mergeFailures.delete(url)
    },
    setChecks(url, state) {
      checks.set(url, state)
    },
    addWorktree(request): AddedWorktree {
      const failure = worktreeFailures.get(request.repoPath)
      if (failure !== undefined) {
        worktreeFailures.delete(request.repoPath)
        throw new Error(failure)
      }
      fake.worktrees.push(request)
      return { path: request.path, branch: request.branch, base: request.base ?? base }
    },
    async openPullRequest(request): Promise<OpenedPullRequest> {
      fake.pullRequests.push(request)
      await Promise.resolve()
      for (const [prefix, message] of prFailures) {
        if (request.path.startsWith(prefix)) throw new Error(message)
      }
      const number = next++
      return { url: `https://github.com/acme/repo/pull/${number}`, number }
    },
    async mergePullRequest(request) {
      fake.merges.push(request)
      await Promise.resolve()
      const failure = mergeFailures.get(request.url)
      if (failure === undefined) return
      const left = (mergeFailuresLeft.get(request.url) ?? 1) - 1
      if (left <= 0) mergeFailures.delete(request.url)
      else mergeFailuresLeft.set(request.url, left)
      throw new Error(failure)
    },
    async commentOnPullRequest(request) {
      fake.comments.push(request)
      await Promise.resolve()
    },
    async pullRequestChecks({ url }) {
      await Promise.resolve()
      return checks.get(url) ?? 'passing'
    },
    async pullRequestDetails(request) {
      fake.detailsRead.push(request)
      await Promise.resolve()
      const failure = detailFailures.get(request.url)
      if (failure !== undefined) throw new Error(failure)
      return {
        title: '',
        state: 'open',
        head: '',
        base,
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        mergeable: 'unknown',
        checks: [],
        ...details.get(request.url),
      }
    },
    async removeWorktree(request) {
      fake.removed.push(request)
      await Promise.resolve()
    },
    async branchWork({ path }) {
      await Promise.resolve()
      return { commits: 0, uncommitted: false, ...branchWork.get(path) }
    },
  }
  return fake
}
