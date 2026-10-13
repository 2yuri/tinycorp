/**
 * The code a ticket turns into, as both processes name it: its worktree per repo, the branch in
 * it, the pull request that came out of it, and what a forge says about that PR. The engine is
 * `src/main/features/code`.
 */

/** A ticket's checkout of one repo, on the ticket's own branch, under the Company folder. */
export interface Worktree {
  ticketId: number
  repoId: string
  path: string
  /** `ticket-<id>-<slug>`. */
  branch: string
  /** The branch its PR goes into. */
  base: string
  createdAt: string
}

/** A ticket's PR in one repo. */
export interface PullRequest {
  ticketId: number
  repoId: string
  url: string
  /** Null when the URL does not end in a PR number. */
  number: number | null
  openedAt: string
}

/** Why a repo without `origin` gets no PR; the code flow and the UI say the same. */
export const NO_REMOTE = 'No remote, cannot open a PR'

/** The badge beside a worktree whose repo has no `origin`. */
export const NO_REMOTE_BADGE = 'No remote'

/** The badge beside a worktree whose repo is on a forge TinyCorp cannot open a PR on. */
export const NO_FORGE_BADGE = 'No forge'

/**
 * Why a repo whose `origin` is on a forge TinyCorp has no adapter for gets no PR. Everything local
 * still works there — the worktree, the branch, the diff, a local merge — so this is a sentence the
 * app says up front rather than a failure an Employee runs into when the work is already done.
 */
export function noForgeReason(host: string): string {
  return `No adapter for ${host}, cannot open a PR`
}

/** Why a repo on a forge whose CLI is not on this Mac gets no PR. */
export function forgeCliMissingReason(forge: string, command: string): string {
  return `${forge} needs the ${command} command, which is not installed here, so no PR can be opened`
}

/** Why a repo can get no PR: the badge beside the row, and the sentence in it. */
export interface PullRequestRefusal {
  /** The badge beside the row, e.g. `No remote`. */
  badge: string
  /** The sentence in the row, and in `#prs`. */
  reason: string
}

/** One repo of a ticket that can get no PR, and why. */
export interface NoPullRequest extends PullRequestRefusal {
  repoId: string
}

/** A refusal, as the app draws it: the engine has the sentence, this picks the badge for it. */
export function refusalOf(reason: string): PullRequestRefusal {
  return { badge: reason === NO_REMOTE ? NO_REMOTE_BADGE : NO_FORGE_BADGE, reason }
}

/** What a ticket has in the Company's repos. */
export interface TicketCode {
  ticketId: number
  worktrees: Worktree[]
  pullRequests: PullRequest[]
  /**
   * Repos of a ticket in Review that can get no PR — no `origin`, or a forge TinyCorp has no
   * adapter for — and why, in words. Absent when every repo can get one.
   */
  withoutPullRequest?: NoPullRequest[]
  /**
   * Repos of a ticket in Review that are `local only`, so TinyCorp opens no PR there by choice
   * (decision 61). Absent when none. Not the same as `withoutPullRequest`: one is a rule the boss
   * chose, the other a fact about the repo's `origin`, and a `local only` repo is only ever here.
   */
  localOnly?: string[]
}

/** A CI check on a PR. `skipped` covers skipped, neutral and cancelled-by-skip runs. */
export type PullRequestCheckState = 'passing' | 'failing' | 'pending' | 'skipped'

export interface PullRequestCheck {
  /** The check's name, e.g. `build`. */
  name: string
  /** The workflow it runs in, or empty for a plain commit status. */
  workflow: string
  state: PullRequestCheckState
  /** From start to completion; null while running or when the forge does not say. */
  durationMs: number | null
}

/** Whether the forge can merge the PR cleanly; `unknown` while it is still computing. */
export type Mergeability = 'mergeable' | 'conflicting' | 'unknown'

/** What a forge says about a PR right now: size, mergeability and checks. */
export interface PullRequestView {
  title: string
  state: 'open' | 'merged' | 'closed'
  /** The PR's branch and the branch it goes into. */
  head: string
  base: string
  additions: number
  deletions: number
  changedFiles: number
  mergeable: Mergeability
  checks: PullRequestCheck[]
}

/** A ticket's PR in one repo, with what its forge says about it. */
export interface PullRequestDetails extends PullRequestView {
  ticketId: number
  repoId: string
  url: string
  number: number | null
}
