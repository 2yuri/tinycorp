import type { PullRequestCheck, PullRequestDetails } from '../../../shared/code'
import { BOSS } from '../../../shared/domain/chat'
import { forgeLabelOf } from '../../../shared/forges'
import type { Review } from '../../../shared/review'
import { countsLabel, type DiffFile, type RepoDiff, type ReviewComment } from '../../../shared/review/review-diff'
import { type ReviewThread, threadsResolvedLabel, unresolvedThreads } from '../../../shared/review/review-threads'

/** One row of the file list: the name on top, the folder under it, the counts on the right. */
export interface FileRow {
  path: string
  /** The last segment, e.g. `currency.ts`. */
  name: string
  /** Everything before it with its trailing slash, e.g. `src/format/`; empty at the root. */
  dir: string
  additions: number
  deletions: number
  /** How many line comments the file carries. */
  comments: number
  viewed: boolean
}

/** `6 FILES · +142 −38` over the file list. */
export function filesCaption(files: DiffFile[]): string {
  const totals = files.reduce(
    (sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  )
  return `${files.length} ${files.length === 1 ? 'FILE' : 'FILES'} · ${countsLabel(totals)}`
}

export function fileRows(files: DiffFile[], comments: ReviewComment[], viewed: ReadonlySet<string>): FileRow[] {
  return files.map((file) => {
    const cut = file.path.lastIndexOf('/')
    return {
      path: file.path,
      name: cut === -1 ? file.path : file.path.slice(cut + 1),
      dir: cut === -1 ? '' : file.path.slice(0, cut + 1),
      additions: file.additions,
      deletions: file.deletions,
      comments: comments.filter((c) => c.path === file.path).length,
      viewed: viewed.has(file.path),
    }
  })
}

/** The comments on one line of one file, oldest first. */
export function commentsOn(comments: ReviewComment[], path: string, line: number | null): ReviewComment[] {
  if (line === null) return []
  return comments.filter((c) => c.path === path && c.line === line)
}

/**
 * The comments of the round under way: those written since it was requested. Earlier ones were
 * settled by the round that followed them, so the panel does not count them again.
 */
export function unresolvedComments(comments: ReviewComment[], review: Review | null): ReviewComment[] {
  if (!review) return comments
  return comments.filter((c) => c.createdAt >= review.requestedAt)
}

/** `1 unresolved comment` / `3 unresolved comments`. */
export function unresolvedLabel(count: number): string {
  return `${count} unresolved ${count === 1 ? 'comment' : 'comments'}`
}

/** What the branch line and the state pill need of a repo's diff. */
export type DiffSummary = Pick<RepoDiff, 'head' | 'base' | 'files' | 'refusal'>

/** `feat/locale-format → main · +142 −38 · 6 files` under the PR's title. */
export function branchLine(diff: DiffSummary | null, details: PullRequestDetails | null): string {
  const head = details?.head || diff?.head || ''
  const base = details?.base || diff?.base || ''
  const files = diff?.files ?? []
  const totals = details ?? {
    additions: files.reduce((n, file) => n + file.additions, 0),
    deletions: files.reduce((n, file) => n + file.deletions, 0),
    changedFiles: files.length,
  }
  const branches = head && base ? `${head} → ${base} · ` : ''
  return `${branches}${countsLabel(totals)} · ${totals.changedFiles} ${totals.changedFiles === 1 ? 'file' : 'files'}`
}

/**
 * The pill beside the PR number: what the forge says about merging it. Without a PR it reads the
 * repo instead — the refusal's own badge in a repo that can never open one (`No remote`, `No
 * forge`), `No PR` while one still can.
 */
export function mergeabilityLabel(
  details: PullRequestDetails | null,
  diff?: Pick<RepoDiff, 'refusal'> | null,
): { label: string; tone: 'ok' | 'bad' | 'unknown' } {
  if (!details) return { label: diff?.refusal?.badge ?? 'No PR', tone: 'unknown' }
  if (details.state === 'merged') return { label: 'Merged', tone: 'ok' }
  if (details.state === 'closed') return { label: 'Closed', tone: 'bad' }
  if (details.mergeable === 'mergeable') return { label: 'Mergeable', tone: 'ok' }
  if (details.mergeable === 'conflicting') return { label: 'Conflicting', tone: 'bad' }
  return { label: 'Checking…', tone: 'unknown' }
}

/**
 * The line under the screen's title: which repo (and PR, when there is one), the branches, who
 * opened it, and the checks. Without a PR it ends in why there is none, never in an empty field.
 */
export function reviewSubtitle(input: {
  repoName: string
  details: PullRequestDetails | null
  diff: DiffSummary | null
  /** The assignee's name, or null while nobody holds the ticket. */
  openedBy: string | null
}): string {
  const { details, diff } = input
  return [
    details && details.number !== null ? `${input.repoName} #${details.number}` : input.repoName,
    diff?.head && diff.base ? `${diff.head} → ${diff.base}` : null,
    input.openedBy ? `opened by ${input.openedBy}` : null,
    details ? checksLine(details.checks) : diff ? (diff.refusal?.reason ?? 'No PR yet') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** `28s`, `1m 04s`, or nothing while a check is still running. */
export function durationLabel(check: PullRequestCheck): string {
  if (check.durationMs === null) return ''
  const seconds = Math.round(check.durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** `2 of 3 checks green`, as the screen's subtitle says it. */
export function checksLine(checks: PullRequestCheck[]): string {
  if (checks.length === 0) return 'no checks'
  const green = checks.filter((c) => c.state === 'passing').length
  return `${green} of ${checks.length} ${checks.length === 1 ? 'check' : 'checks'} green`
}

/** The sentence over the actions: where the round stands and what is still open. */
export function roundSummary(review: Review | null, unresolved: number, nameOf: (id: string) => string): string {
  const open = unresolved > 0 ? ` · ${unresolvedLabel(unresolved)}` : ''
  if (!review) return `Not in review yet${open}`
  const who = review.decidedBy === null ? nameOf(review.reviewerId) : nameOf(review.decidedBy)
  if (review.merge === 'merged') return `Merged${open}`
  if (review.merge === 'failed') return `The merge failed${open}`
  if (review.merge === 'refused') return `${who} approved · the repo does not allow merging`
  if (review.merge === 'waiting') return `${who} approved · the merge waits for you`
  if (review.status === 'approved') return `${who} approved${open}`
  if (review.status === 'changes_requested') return `${who} requested changes${open}`
  return `Waiting for ${who}${open}`
}

/** The name to show for a person, the boss reading as `you`. */
export function reviewerName(id: string, employees: { id: string; name: string }[]): string {
  if (id === BOSS) return 'you'
  return employees.find((e) => e.id === id)?.name ?? 'a former employee'
}

/**
 * The same name with the role that gave the verdict — `Iris (QA)`, as the frame writes it. The boss
 * has no role to name, and neither has anyone who has left.
 */
export function reviewerLabel(id: string, employees: { id: string; name: string; title?: string }[]): string {
  const name = reviewerName(id, employees)
  const title = employees.find((e) => e.id === id)?.title?.trim()
  return id === BOSS || !title ? name : `${name} (${title})`
}

/**
 * The line under the panel's `Review` heading: `web-app #131 · round 2 of 2`. The round is the
 * ticket's own count, never the row id, and a repo with no PR keeps its name alone.
 */
export function reviewRoundLine(input: {
  repoName: string
  details: PullRequestDetails | null
  review: Review | null
}): string {
  const { details, review } = input
  const repo = details && details.number !== null ? `${input.repoName} #${details.number}` : input.repoName
  return review ? `${repo} · round ${review.round} of ${review.rounds}` : repo
}

/** `TC-142 · <title>` — what the screen's header says, from the Company key. */
export function reviewTitle(key: string, ticketId: number, title: string): string {
  return `${key}-${ticketId} · ${title}`
}

/** Whether the boss may still decide this round: it is open and nothing is merging. */
export function canDecide(review: Review | null, column: string): boolean {
  if (column !== 'review') return false
  return review === null || (review.merge !== 'merging' && review.merge !== 'merged')
}

/**
 * The reviewer card's second line: `2 rounds · 5 of 6 threads resolved` (frame `VtAMR`). A review
 * with no threads says the rounds alone rather than `0 of 0`.
 */
export function reviewerCardLine(review: Review | null, threads: readonly ReviewThread[]): string {
  if (!review) return ''
  const rounds = `${review.rounds} ${review.rounds === 1 ? 'round' : 'rounds'}`
  const resolved = threadsResolvedLabel(threads)
  return resolved ? `${rounds} · ${resolved}` : rounds
}

/** How far the conversation has got: resolved threads over all of them, 0 to 1. */
export function threadsProgress(threads: readonly ReviewThread[]): number {
  if (threads.length === 0) return 0
  return threads.filter((thread) => thread.state === 'resolved').length / threads.length
}

/** `Approved` / `Changes requested` / `Reviewing`, the pill beside the reviewer's name. */
export function verdictPill(review: Review | null): { label: string; tone: 'ok' | 'bad' | 'unknown' } {
  if (!review) return { label: 'Not in review', tone: 'unknown' }
  if (review.status === 'approved') return { label: 'Approved', tone: 'ok' }
  if (review.status === 'changes_requested') return { label: 'Changes requested', tone: 'bad' }
  return { label: 'Reviewing', tone: 'unknown' }
}

/** One entry of the panel's round timeline: what happened, who by, and when. */
export interface RoundEvent {
  key: string
  title: string
  detail: string
  /** `09:44`, from the moment it happened. */
  at: string
  tone: 'reviewer' | 'assignee' | 'handoff'
}

/**
 * The rounds of a review as the panel lists them (frame `VtAMR`): each round's verdict, what the
 * assignee pushed between them — read off the commits their replies named — and the moment the
 * ticket reached the boss, or the fact that it has not.
 *
 * Everything here comes from the threads and the round the engine already holds: nothing is
 * recorded twice just to draw this.
 */
export function roundTimeline(
  review: Review | null,
  threads: readonly ReviewThread[],
  nameOf: (id: string) => string,
): RoundEvent[] {
  if (!review) return []
  const events: RoundEvent[] = []
  for (let round = 1; round <= review.rounds; round++) {
    const mine = threads.filter((thread) => thread.round === round)
    const last = round === review.rounds
    const closed = last ? review.decidedAt : null
    const verdict = last ? (review.status === 'pending' ? 'under way' : verdictWord(review)) : 'changes requested'
    events.push({
      key: `round-${round}`,
      title: `Round ${round} · ${verdict}`,
      // A round that opened threads is described by them; a round that opened none — the one that
      // settles the last argument — is described by what it settled instead.
      detail: `${nameOf(review.reviewerId)} · ${mine.length > 0 ? openedLabel(mine) : settledLabel(threads, round)}`,
      at: timeOf(closed ?? review.requestedAt),
      tone: 'reviewer',
    })
    const answers = threads.flatMap((thread) => thread.messages.filter((message) => message.round === round))
    const commits = [...new Set(answers.map((message) => message.commit).filter((sha): sha is string => Boolean(sha)))]
    const pushbacks = answers.filter((message) => !message.commit && message.authorId !== review.reviewerId)
    if (commits.length > 0 || pushbacks.length > 0) {
      events.push({
        key: `answers-${round}`,
        title:
          commits.length > 0 ? `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'} pushed` : 'Answered',
        detail: [commits.join(', '), pushbacks.length > 0 ? `${pushbacks.length} pushback` : '']
          .filter(Boolean)
          .join(' · '),
        at: timeOf(answers.at(-1)?.createdAt ?? review.requestedAt),
        tone: 'assignee',
      })
    }
  }
  events.push(handoffEvent(review))
  return events
}

/** `3 threads on 1 file`, what a round opened. */
function openedLabel(threads: readonly ReviewThread[]): string {
  const files = new Set(threads.map((thread) => thread.path ?? 'the pull request')).size
  return `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} on ${files} ${files === 1 ? 'file' : 'files'}`
}

/** `resolved 2 of 3 threads`, what a round settled — or that it settled none. */
function settledLabel(threads: readonly ReviewThread[], round: number): string {
  const resolved = threads.filter((thread) => thread.state === 'resolved').length
  if (threads.length === 0) return 'nothing to answer'
  return round > 1 ? `resolved ${resolved} of ${threads.length} threads` : 'no threads opened'
}

function verdictWord(review: Review): string {
  return review.status === 'approved' ? 'approved' : 'changes requested'
}

/** The last row of the timeline: where the ticket stands with the boss. */
function handoffEvent(review: Review): RoundEvent {
  const at = timeOf(review.decidedAt ?? review.requestedAt)
  if (review.handoff === 'ready') {
    return {
      key: 'handoff',
      title: 'Ready for you',
      detail: `Handed to the boss · round ${review.rounds} of ${review.roundLimit}`,
      at,
      tone: 'handoff',
    }
  }
  if (review.handoff === 'your_call') {
    return {
      key: 'handoff',
      title: 'Your call',
      detail: `The round limit of ${review.roundLimit} was reached and they are still apart`,
      at,
      tone: 'handoff',
    }
  }
  return {
    key: 'handoff',
    title: 'In review between agents',
    detail: `Round ${review.rounds} of ${review.roundLimit} · you are not being asked yet`,
    at,
    tone: 'handoff',
  }
}

/** `09:44` from an ISO moment, the way the panel and every comment write one. */
export function timeOf(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The first thread still open, for `Jump to open thread`; null when none is. */
export function firstOpenThread(threads: readonly ReviewThread[]): ReviewThread | null {
  return unresolvedThreads(threads)[0] ?? null
}

/**
 * Where the conversation also lives: `Also on <forge> · PR #88 · posted as a review`, with the
 * forge read off the thread's own URL — or the sentence the panel says when no forge is carrying
 * it (T170).
 */
export function forgeLine(input: { onForge: boolean; url: string | null; number: number | null }): {
  label: string
  url: string | null
} {
  if (!input.onForge || !input.url) {
    return { label: 'In this app only · this repo’s forge cannot hold a review thread', url: null }
  }
  const forge = forgeLabelOf(input.url) ?? 'the forge'
  const pr = input.number === null ? '' : ` · PR #${input.number}`
  return { label: `Also on ${forge}${pr} · posted as a review`, url: input.url }
}
