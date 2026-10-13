import type { DatabaseSync } from 'node:sqlite'
import type { Approval, ApprovalOutcome } from '../../../shared/approvals'
import { ticketSubject } from '../../../shared/approvals/approval-subject'
import type { PullRequest } from '../../../shared/code'
import type { Column } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, type Mentionable } from '../../../shared/domain/chat'
import type { MergeState, Review, ReviewHandoff, ReviewStatus, ReviewVerdict } from '../../../shared/review'
import {
  blockingThreads,
  type NewReviewThread,
  type ReviewThread,
  type ThreadState,
  threadAnchor,
  unresolvedThreads,
} from '../../../shared/review/review-threads'
import type { Migration } from '../../core'
import { companyKeyOf, ticketCodeIn } from '../../core'
import type { GitService } from '../../platform'
import type { CompanyApprovals } from '../approvals'
import type { Chat } from '../chat'
import { type CodeFlow, PRS_CHANNEL } from '../code'
import type { NewInboxItem } from '../inbox'
import { mergeRefusal } from '../repos'
import type { ActingBoard } from '../sessions'
import type { Routing } from '../staff'
import type { ReviewThreads } from './review-threads'

/**
 * The review flow's migration step, appended to the engine's migrations: one row per review round
 * of a ticket, and the PRs merged so far.
 */
export const REVIEW_FLOW_MIGRATION: Migration = {
  name: 'review-flow-reviews-and-merges',
  sql: `
  CREATE TABLE review (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    reviewer_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    comments TEXT NOT NULL DEFAULT '',
    merge TEXT,
    approval_id INTEGER UNIQUE REFERENCES approval (id),
    merge_error TEXT,
    message_id INTEGER NOT NULL REFERENCES message (id),
    requested_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX review_by_ticket ON review (ticket_id, id);
  CREATE TABLE merged_pull_request (
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    repo_id TEXT NOT NULL,
    merged_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, repo_id)
  );
`,
}

/** Tickets' review rounds, and the boss's side of review and merge. */
export interface Reviews {
  /** A ticket's latest review round, or null before its first. */
  of(ticketId: number): Review | null
  /** The latest round of every ticket that has one, by ticket id. */
  list(): Review[]
  /**
   * The boss approves a ticket in Review, whoever it was routed to, and its PRs merge now: the boss
   * is the merge gate. Retries a merge that failed.
   */
  approve(ticketId: number, comments?: string): Review
  /** The boss sends a ticket in Review back to its assignee with `comments`. */
  requestChanges(ticketId: number, comments: string): Review
}

/** What one Employee can do about reviews. */
export interface EmployeeReviews {
  of(ticketId: number): Review | null
  /**
   * The assigned reviewer's verdict, which closes the round. `request_changes` sends the ticket
   * back to Doing and its assignee with every open thread, unless the round limit has been reached
   * — then it stops with the boss instead. `approve` asks to merge, behind the `merge` gate, and is
   * refused while a blocking thread is still open.
   */
  submit(input: { ticketId: number; verdict: ReviewVerdict; comments: string }): Review
  /**
   * The assignee saying their fixes are pushed: the ticket goes back to Review and the next round
   * starts, waking the reviewer once with every thread still open.
   */
  ready(input: { ticketId: number; summary?: string }): Review
  /**
   * Asks for the merge again after it failed — a conflict, or the base moved — once the branch is
   * up to date and pushed (T276). It goes through the merge gate like the first merge did.
   */
  retryMerge(ticketId: number): Review
  /** The ticket's review conversation, oldest thread first. */
  threads(ticketId: number): ReviewThread[]
  thread(threadId: number): ReviewThread | null
  /** Who holds the ticket, so a tool can tell the reviewer's half from the assignee's. */
  assigneeOf(ticketId: number): string | null
  /** Opens a thread as this Employee, in the round under way. */
  openThread(input: NewReviewThread): ReviewThread
  /** Answers a thread as this Employee. */
  replyInThread(input: { threadId: number; body: string; commit?: string }): ReviewThread
  setThreadState(threadId: number, state: ThreadState): ReviewThread
}

/**
 * One Company's review flow. A ticket in Review with every PR open gets a review round, routed to
 * an Employee holding `review` other than the assignee, else to the boss. An approved round merges
 * the PRs, behind the `merge` gate for Employees, then removes the worktrees and moves the ticket
 * to Done.
 */
export interface CompanyReviews extends Reviews {
  /** The review actions of the Employee `employeeId`. */
  as(employeeId: string): EmployeeReviews
  /** Called when a ticket in Review has every PR open: starts a round unless one is under way. */
  readyForReview(ticketId: number): void
  /**
   * Testing passed (T174): the merge the approved round was holding goes ahead now, through the
   * same gate it would have gone through the moment review approved.
   */
  testingPassed(ticketId: number): void
  /** The security pass cleared, or the boss overrode it (T241): the held merge goes ahead. */
  securityCleared(ticketId: number): void
  /** Carries out, or closes, the merge behind a decided Approval. Ignores other Approvals. */
  decided(approval: Approval): void
}

export interface ReviewFlowOptions {
  db: DatabaseSync
  chat: Chat
  approvals: CompanyApprovals
  routing: Routing
  code: CodeFlow & {
    /** Forgets a worktree that was removed from disk. */
    worktreeRemoved(ticketId: number, repoId: string): void
    /**
     * The board acting as `actorId`, with the code flow's own side effects: this is what moves a
     * ticket back into Review and opens any missing PR, which is how a round starts.
     */
    boardAs(actorId: string): ActingBoard
  }
  /** The board acting as `actorId`. */
  board(actorId: string): ActingBoard
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** The ticket's review conversation: what a round is woken with and what an approval waits on. */
  threads: ReviewThreads
  /** Without one, nothing merges. */
  git?: GitService
  /**
   * The Testing stage (T174). An approved round hands the ticket to it instead of raising the
   * merge gate, unless `enter` says the ticket's repos are tested by nobody. Absent in a Company
   * engine built without it, which is then exactly the flow that shipped before Testing existed.
   */
  tests?: {
    /** True when the ticket went into Testing; false when it is the merge gate's turn as before. */
    enter(ticketId: number, approvedBy: string): boolean
    /** Why the merge waits, or null when Testing is not in the way. */
    refusal(ticketId: number): string | null
  }
  /**
   * The security pass (T241). A round that starts tells it so it can ask the Company's Security
   * Employee to read the same change; nothing merges while it says the merge waits. Absent in a
   * Company engine built without it, which is the flow exactly as it was.
   */
  security?: {
    /** A round started: ask for a pass when the Company has somebody and the change asks for one. */
    roundStarted(review: Review): void
    /** Why the merge waits on security, or null. */
    refusal(ticketId: number): string | null
  }
  onChange(): void
  log(line: string): void
  /** A review round was asked for, or a ticket's PRs were merged. For the activity log. */
  onReviewEvent?(
    event:
      | { kind: 'requested'; ticketId: number; title: string; reviewerId: string; requesterId: string }
      | { kind: 'merged'; ticketId: number; title: string; repos: string[]; actorId: string },
  ): void
}

interface TicketRow {
  id: number
  title: string
  column_id: Column
  assignee_id: string | null
}

interface ReviewRow {
  id: number
  ticket_id: number
  reviewer_id: string
  status: ReviewStatus
  decided_by: string | null
  comments: string
  merge: MergeState | null
  approval_id: number | null
  merge_error: string | null
  message_id: number
  requested_at: string
  decided_at: string | null
}

/** Merge states during which a round needs no new review. */
const UNDER_WAY: (MergeState | null)[] = ['waiting', 'merging', 'merged']

/** GitHub turns a merge away while its base moves under it, and says to try again (T276). */
const BASE_MOVED = /base branch was modified/i

/** How long to wait before each new try of a merge whose base moved: two more tries, then it fails. */
const BASE_MOVED_WAITS_MS = [500, 1500] as const

export function createReviewFlow({
  db,
  chat,
  approvals,
  routing,
  code,
  board,
  deliver,
  threads,
  git,
  tests,
  security,
  onChange,
  log,
  onReviewEvent,
}: ReviewFlowOptions): CompanyReviews {
  function ticket(id: number): TicketRow | undefined {
    return db.prepare('SELECT id, title, column_id, assignee_id FROM ticket WHERE id = ?').get(id) as
      | TicketRow
      | undefined
  }

  function repo(id: string): { name: string; path: string } | undefined {
    return db.prepare('SELECT name, path FROM repo WHERE id = ?').get(id) as { name: string; path: string } | undefined
  }

  function repoName(id: string): string {
    return repo(id)?.name ?? 'removed repo'
  }

  /** How every line here names a ticket: `TC-142` (decision 33). */
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function people(): Mentionable[] {
    return chat.people()
  }

  function isEmployee(id: string): boolean {
    return people().some((p) => p.id === id)
  }

  function nameOf(id: string): string {
    return id === BOSS ? BOSS : (people().find((p) => p.id === id)?.name ?? 'former employee')
  }

  function subjectOf(row: TicketRow): string {
    return ticketSubject(companyKeyOf(db), row.id, row.title)
  }

  function mergedRepoIds(ticketId: number): string[] {
    const rows = db
      .prepare('SELECT repo_id FROM merged_pull_request WHERE ticket_id = ? ORDER BY merged_at, rowid')
      .all(ticketId) as { repo_id: string }[]
    return rows.map((r) => r.repo_id)
  }

  /** How many rounds the ticket has had, and which of them a row is: `round 2 of 2`. */
  function rounds(row: ReviewRow): { round: number; rounds: number } {
    const count = (sql: string, ...args: number[]) =>
      Number((db.prepare(sql).get(row.ticket_id, ...args) as { n: number }).n)
    return {
      round: count('SELECT COUNT(*) AS n FROM review WHERE ticket_id = ? AND id <= ?', row.id),
      rounds: count('SELECT COUNT(*) AS n FROM review WHERE ticket_id = ?'),
    }
  }

  /**
   * How far a round has got towards the boss (T170). An approval is the reviewer handing the PR
   * over; changes requested on the last round the Company allows is the argument becoming the
   * boss's. Everything else is still between the agents, and the boss is asked nothing.
   */
  function handoffOf(row: ReviewRow, count: { round: number; rounds: number }, limit: number): ReviewHandoff {
    // A merge the boss has already decided is not something they are still being asked about.
    if (row.merge === 'merged' || row.merge === 'rejected') return 'agents'
    if (row.status === 'approved') return 'ready'
    if (row.status === 'changes_requested' && row.decided_by !== BOSS && count.rounds >= limit) return 'your_call'
    return 'agents'
  }

  function toReview(row: ReviewRow): Review {
    const count = rounds(row)
    const roundLimit = threads.roundLimit()
    return {
      id: row.id,
      ...count,
      handoff: handoffOf(row, count, roundLimit),
      roundLimit,
      ticketId: row.ticket_id,
      reviewerId: row.reviewer_id,
      status: row.status,
      decidedBy: row.decided_by,
      comments: row.comments,
      merge: row.merge,
      approvalId: row.approval_id,
      mergedRepoIds: mergedRepoIds(row.ticket_id),
      mergeError: row.merge_error,
      messageId: row.message_id,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
    }
  }

  function latest(ticketId: number): Review | null {
    const row = db.prepare('SELECT * FROM review WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').get(ticketId) as
      | ReviewRow
      | undefined
    return row ? toReview(row) : null
  }

  function round(id: number): Review {
    return toReview(db.prepare('SELECT * FROM review WHERE id = ?').get(id) as unknown as ReviewRow)
  }

  function setMerge(id: number, merge: MergeState | null, error: string | null = null): void {
    db.prepare('UPDATE review SET merge = ?, merge_error = ? WHERE id = ?').run(merge, error, id)
    onChange()
  }

  /** Posts a code-flow event to `#prs`, top level or in a round's thread. */
  function announce(text: string, threadOf?: Review): void {
    if (threadOf) chat.reply({ authorId: COMPANY_AUTHOR, messageId: threadOf.messageId, text })
    else chat.post({ authorId: COMPANY_AUTHOR, channelId: PRS_CHANNEL, text })
  }

  function prList(pulls: PullRequest[]): string {
    return pulls.map((p) => `${repoName(p.repoId)} ${p.url}`).join(', ')
  }

  /** The ticket in Review, with every PR open; throws otherwise. */
  function reviewable(ticketId: number): TicketRow {
    const row = ticket(ticketId)
    if (!row) throw new Error(`There is no ticket ${idOf(ticketId)}`)
    // A ticket in Testing is one review already approved (T174): it is still the round's ticket,
    // and the boss acting on it — retrying a merge, sending it back — acts on that same round.
    if (row.column_id !== 'review' && row.column_id !== 'testing') {
      throw new Error(`${idOf(ticketId)} is not in review`)
    }
    const { worktrees, pullRequests, localOnly = [] } = code.of(ticketId)
    if (pullRequests.length === 0) throw new Error(`${idOf(ticketId)} has no PR yet`)
    // A `local only` repo never gets a PR, so it is not one the round waits for. A repo without an
    // origin still is: the boss can add one and send the ticket back to Review.
    const opened = new Set([...pullRequests.map((p) => p.repoId), ...localOnly])
    if (worktrees.some((w) => !opened.has(w.repoId))) throw new Error(`${idOf(ticketId)} still has PRs to open`)
    return row
  }

  /**
   * What the assignee said when they handed the ticket back, read by the round that starts next.
   * It lives only for the length of that synchronous call: `review_ready` sets it, moving the
   * ticket to Review starts the round inside the same tick, and the `finally` clears it. A round
   * that starts later — because a PR was still opening — simply has no note, which is the truth.
   */
  let handback: string | null = null

  function withHandback<T>(note: string, action: () => T): T {
    handback = note.trim() || null
    try {
      return action()
    } finally {
      handback = null
    }
  }

  /** `src/format/currency.ts:20 — Iris: "…"`, one line per thread the round still owes an answer. */
  function threadLines(list: readonly ReviewThread[]): string {
    return list
      .map((thread) => {
        const last = thread.messages.at(-1)
        const note = thread.state === 'non_blocking' ? ' (non-blocking note)' : ''
        return `#${thread.id} ${threadAnchor(thread)}${note} — ${nameOf(last?.authorId ?? BOSS)}: ${JSON.stringify(last?.body ?? '')}`
      })
      .join('; ')
  }

  function startRound(row: TicketRow, reviewerId: string): Review {
    const author = row.assignee_id ?? BOSS
    const note = handback
    const { worktrees, pullRequests } = code.of(row.id)
    const label = reviewerId === BOSS ? `@${BOSS}` : nameOf(reviewerId)
    const message = chat.post({
      authorId: COMPANY_AUTHOR,
      channelId: PRS_CHANNEL,
      text: `Review requested from ${label} for ${subjectOf(row)}: ${prList(pullRequests)}`,
    })
    const { lastInsertRowid } = db
      .prepare('INSERT INTO review (ticket_id, reviewer_id, message_id, requested_at) VALUES (?, ?, ?, ?)')
      .run(row.id, reviewerId, message.id, message.createdAt)
    onChange()
    // Every thread the last round left open travels with the round, so the reviewer is woken once
    // with the whole conversation rather than once per comment (T170).
    const open = unresolvedThreads(threads.list(row.id))
    if (reviewerId !== BOSS) {
      const authorName = nameOf(author)
      const list = pullRequests
        .map((p) => {
          const w = worktrees.find((x) => x.repoId === p.repoId)
          const where = w ? `, branch ${w.branch} into ${w.base}, worktree ${w.path}` : ''
          return `${repoName(p.repoId)}: PR ${p.url}${where}`
        })
        .join('; ')
      deliver({
        employeeId: reviewerId,
        kind: 'review',
        fromId: author,
        channelId: PRS_CHANNEL,
        threadId: null,
        messageId: message.id,
        ticketId: row.id,
        text: `Review ${subjectOf(row)}`,
        prompt:
          `[company] review requested from ${authorName} for ticket ${idOf(row.id)} ${JSON.stringify(row.title)}: ${list}. ` +
          (note ? `${authorName} says: ${JSON.stringify(note)}. ` : '') +
          'Review it read-only: read the change with `git diff <base>...<branch>` and by reading files in the ' +
          'worktree, but never edit, commit, push or check out anything there; ' +
          `the worktrees belong to ${authorName}. ` +
          (open.length > 0
            ? `Still open from the last round: ${threadLines(open)}. Answer each one: review_reply is theirs, ` +
              'yours are review_comment to say more and review_resolve to close one. '
            : '') +
          'Open a thread on a line with review_comment (blocking false leaves it as a note that will not ' +
          'block the merge), close one with review_resolve, and end the round with review_submit: ' +
          `ticket_id ${row.id}, verdict "approve" or "changes", and a summary. Your whole round goes on the ` +
          `PR as one review. Approving needs every blocking thread resolved; notes may stay open. ` +
          'Talk through the company MCP server, never in plain text.',
      })
    }
    onReviewEvent?.({ kind: 'requested', ticketId: row.id, title: row.title, reviewerId, requesterId: author })
    const started = round(Number(lastInsertRowid))
    // The security pass reads the same change beside this round, not after it (T241).
    security?.roundStarted(started)
    return started
  }

  /** The round a verdict applies to, starting one for the boss when none is open. */
  function openRound(row: TicketRow): Review {
    const last = latest(row.id)
    if (last?.merge === 'merging') throw new Error(`${idOf(row.id)} is already merging`)
    if (last?.merge === 'merged') throw new Error(`${idOf(row.id)} is already merged`)
    // A round already waiting on the boss is the round they are deciding, whatever its verdict was:
    // at the round limit that is a round of changes requested, and it still has their gate on it.
    if (last?.merge === 'waiting') return last
    if (last && (last.status === 'pending' || (last.status === 'approved' && last.merge !== 'rejected'))) return last
    return startRound(row, BOSS)
  }

  /**
   * Closes a round with a verdict.
   *
   * The reviewer's round goes up on the PR as one review — the threads it opened and the summary
   * together — and only then does anything reach the boss: an approval forwards the merge, and
   * changes requested send the ticket back to its assignee, unless this was the last round the
   * Company allows and the two of them are still apart. Then it stops here and the merge gate is
   * raised with both positions in it (T170).
   */
  function decide(review: Review, byId: string, verdict: ReviewVerdict, comments: string): Review {
    const row = ticket(review.ticketId)!
    const status: ReviewStatus = verdict === 'approve' ? 'approved' : 'changes_requested'
    db.prepare(
      'UPDATE review SET status = ?, decided_by = ?, comments = ?, merge = NULL, decided_at = ? WHERE id = ?',
    ).run(status, byId, comments, new Date().toISOString(), review.id)
    const by = nameOf(byId)
    const said = verdict === 'approve' ? 'approved' : 'requested changes'
    announce(`${by} ${said}${comments ? `: ${comments}` : '.'}`, review)
    publishRound(review, verdict, `**${by} ${said}** (tinycorp review)${comments ? `\n\n${comments}` : ''}`)
    if (verdict === 'approve') forwardMerge(review, byId)
    else if (atTheLimit(review, byId)) stopWithTheBoss(row, review, byId, comments)
    else bounce(row, byId, comments)
    onChange()
    return round(review.id)
  }

  /** Whether this round's changes are the Company's last: the agents have had their rounds. */
  function atTheLimit(review: Review, byId: string): boolean {
    return byId !== BOSS && review.rounds >= threads.roundLimit()
  }

  /**
   * Sends the round to the PR. A repo whose forge can hold a review gets one review with this
   * round's threads in it; one that cannot gets the summary as a plain comment, which is what the
   * app could always do.
   */
  function publishRound(review: Review, verdict: ReviewVerdict, body: string): void {
    const threadIds = threads
      .list(review.ticketId)
      .filter((thread) => thread.round === review.round)
      .map((thread) => thread.id)
    if (threads.onForge(review.ticketId)) {
      threads.publish({
        ticketId: review.ticketId,
        threadIds,
        summary: body,
        verdict: verdict === 'approve' ? 'approve' : 'changes',
      })
      return
    }
    const row = ticket(review.ticketId)
    if (row) commentOnPullRequests(row, body)
  }

  /**
   * The round limit reached with the reviewer and the assignee still apart: the ticket stays in
   * Review, nobody is sent back to work, and the boss is asked — with both positions and the
   * threads that are still open (frame `F2HxCz`, card c).
   */
  function stopWithTheBoss(row: TicketRow, review: Review, byId: string, comments: string): void {
    const limit = threads.roundLimit()
    const open = blockingThreads(threads.list(row.id))
    announce(
      `${nameOf(byId)} and ${nameOf(row.assignee_id ?? BOSS)} are still apart after ${limit} ` +
        `${limit === 1 ? 'round' : 'rounds'}, so ${idOf(row.id)} is the boss’s call.`,
      review,
    )
    setMerge(review.id, 'waiting')
    let outcome: ApprovalOutcome
    try {
      outcome = approvals.request({
        requesterId: byId,
        action: 'merge',
        ticketId: row.id,
        reason:
          `${nameOf(byId)} and ${nameOf(row.assignee_id ?? BOSS)} disagree after ${limit} ` +
          `${limit === 1 ? 'round' : 'rounds'} on ${subjectOf(row)}. ${nameOf(byId)}: ${comments || 'changes requested'}.` +
          (open.length > 0 ? ` Still open: ${threadLines(open)}.` : ''),
        // The boss is asked whatever the autonomy level says: the round limit is a limit, and an
        // argument the agents could not settle is the one thing Autonomous was never meant to decide.
        conditions: { limitExceeded: true },
      })
    } catch (error) {
      // A repo TinyCorp may not merge refuses the request outright (decision 61). The round still
      // stops here — the boss reads the argument in the thread and decides in the repo itself.
      setMerge(review.id, 'refused', error instanceof Error ? error.message : String(error))
      announce(`${latest(row.id)?.mergeError ?? 'This repo may not be merged from here.'}`, review)
      return
    }
    if (outcome.gate === 'free') return
    db.prepare('UPDATE review SET approval_id = ? WHERE id = ?').run(outcome.approval.id, review.id)
    onChange()
  }

  function commentOnPullRequests(row: TicketRow, body: string): void {
    if (!git) return
    for (const pr of code.of(row.id).pullRequests) {
      const found = repo(pr.repoId)
      if (!found) continue
      git
        .commentOnPullRequest({ repoPath: found.path, url: pr.url, body })
        .catch((error: unknown) => log(`Could not comment on ${pr.url}: ${String(error)}`))
    }
  }

  /**
   * Sends the ticket back to Doing and wakes its assignee **once**, with the round's whole
   * conversation: every thread still open, not one wake per comment (T170).
   */
  function bounce(row: TicketRow, byId: string, reason: string): void {
    const current = ticket(row.id)
    if (current?.column_id === 'review' || current?.column_id === 'testing') board(byId).moveTicket(row.id, 'doing')
    const assignee = current?.assignee_id
    if (!assignee || assignee === byId || !isEmployee(assignee)) return
    const places = code
      .of(row.id)
      .worktrees.map((w) => `${repoName(w.repoId)}: ${w.path}`)
      .join('; ')
    const open = unresolvedThreads(threads.list(row.id))
    deliver({
      employeeId: assignee,
      kind: 'review',
      fromId: byId,
      channelId: PRS_CHANNEL,
      threadId: latest(row.id)?.messageId ?? null,
      messageId: null,
      ticketId: row.id,
      text: `Changes requested on ${subjectOf(row)}: ${reason}`,
      prompt:
        `[company] changes requested by ${nameOf(byId)} on your ticket ${idOf(row.id)} ${JSON.stringify(row.title)}: ` +
        `${JSON.stringify(reason)}. ${idOf(row.id)} is back in doing. ` +
        (open.length > 0
          ? `${open.length} ${open.length === 1 ? 'thread is' : 'threads are'} open: ${threadLines(open)}. ` +
            'Answer every one of them with review_reply — the thread id, what you did, and the commit when you ' +
            'fixed it; push back in the same thread when you think the change is right as it is. '
          : '') +
        `Fix what needs fixing in your worktrees (${places}), commit and push there; the PRs follow the branch. ` +
        `Then call review_ready, which starts the next round and wakes ${nameOf(byId)}. ` +
        'Talk through the company MCP server, never in plain text.',
    })
  }

  /**
   * Why the round's PRs may not be merged, or null. Two refusals, and either alone stops the merge:
   * first the repo's rung, which the boss chose, so it names the repo and the rung (decision 61);
   * then the forge, a fact about the repo's `origin`, so it names the forge. Read at each step so a
   * repo moved down the ladder, or off its forge, mid-flight is obeyed by the next merge, and the
   * PRs already open stay open. The policy is asked here, in front of the forge adapter, never in it.
   */
  function refusedMerge(ticketId: number): string | null {
    const pulls = code.of(ticketId).pullRequests
    return (
      mergeRefusal(
        db,
        pulls.map((p) => p.repoId),
      ) ?? refusedByForge(ticketId, pulls)
    )
  }

  /** Why a PR still to merge cannot be merged through its forge — its `origin` has none now — or null. */
  function refusedByForge(ticketId: number, pulls: PullRequest[]): string | null {
    if (!git) return null
    const done = new Set(mergedRepoIds(ticketId))
    for (const pr of pulls.filter((p) => !done.has(p.repoId))) {
      const found = repo(pr.repoId)
      const reason = found ? git.pullRequestRefusal(found.path) : null
      if (found && reason) {
        return `${found.name} cannot be merged from here: ${reason}, and TinyCorp merges a PR only through its forge.`
      }
    }
    return null
  }

  /** Records that the repo refuses the merge and says so in the round's thread. Nothing is closed. */
  function refuseMerge(review: Review, refusal: string): void {
    setMerge(review.id, 'refused', refusal)
    announce(`${refusal} The PRs stay open and the ticket waits in review.`, review)
  }

  /**
   * After an approval: into Testing when somebody tests this ticket (T174), else merges now for the
   * boss, else asks the `merge` gate with the PRs' CI state.
   */
  function forwardMerge(review: Review, byId: string): void {
    // The repo and its forge are asked before the boss is: no autonomy level, Autonomous included,
    // gets past either.
    const refusal = refusedMerge(review.ticketId)
    if (refusal) return void refuseMerge(review, refusal)
    // A security pass that is not finished, or that found something high and open, is asked before
    // the boss too: an approval is not a decision about a vulnerability nobody has answered (T241).
    const waitingOnSecurity = security?.refusal(review.ticketId)
    if (waitingOnSecurity) return void announce(waitingOnSecurity, review)
    // Testing comes before the gate, not after it: the boss is never asked to approve a merge of
    // something nobody has run yet, whatever the autonomy level says.
    if (tests?.enter(review.ticketId, byId)) return
    if (byId === BOSS) return void startMerge(review)
    setMerge(review.id, 'waiting')
    void (async () => {
      const row = ticket(review.ticketId)
      if (!row) return
      const red = await failingRepos(row.id)
      if (!db.isOpen || latest(row.id)?.id !== review.id || latest(row.id)?.merge !== 'waiting') return
      const pulls = code.of(row.id).pullRequests
      const outcome = approvals.request({
        requesterId: byId,
        action: 'merge',
        ticketId: row.id,
        reason:
          `${nameOf(byId)} approved ${subjectOf(row)}; this merges ${prList(pulls)}.` +
          (red.length > 0 ? ` CI is failing in ${red.join(', ')}.` : ''),
        conditions: { ciRed: red.length > 0 },
      })
      if (outcome.gate === 'free') return startMerge(review)
      db.prepare('UPDATE review SET approval_id = ? WHERE id = ?').run(outcome.approval.id, review.id)
      onChange()
      announce('The merge waits for the boss’s approval.', review)
    })().catch((error: unknown) => log(`Asking to merge ${idOf(review.ticketId)} failed: ${String(error)}`))
  }

  /**
   * A stage that was holding an approved round let go — Testing passed, or the security pass
   * cleared. Whoever approved the review is still the one asking to merge: an agent's approval goes
   * through the boss's gate, the boss's own merges now. Neither stage decided anything about that.
   */
  function resume(ticketId: number): void {
    const review = latest(ticketId)
    if (!review || review.status !== 'approved' || review.merge !== null) return
    forwardMerge(review, review.decidedBy ?? BOSS)
  }

  /**
   * An Employee asked for a merge with approval_request instead of merge_retry, and the boss said
   * yes: when that ticket's approved round failed to merge, the approval is the go-ahead to merge
   * again (T276). A ticket with no PR is the merge gate's; anything else has nothing to retry.
   */
  function retriedByApproval(approval: Approval): void {
    if (approval.status !== 'approved' || approval.ticketId === null) return
    if (code.of(approval.ticketId).pullRequests.length === 0) return
    const review = latest(approval.ticketId)
    if (review?.status !== 'approved' || review.merge !== 'failed') return
    const column = ticket(review.ticketId)?.column_id
    if (column === 'review' || column === 'testing') startMerge(review)
  }

  /** Names of the ticket's repos whose PR has failing CI. An unreadable state counts as not failing. */
  async function failingRepos(ticketId: number): Promise<string[]> {
    if (!git) return []
    const red: string[] = []
    for (const pr of code.of(ticketId).pullRequests) {
      const found = repo(pr.repoId)
      if (!found) continue
      try {
        if ((await git.pullRequestChecks({ repoPath: found.path, url: pr.url })) === 'failing') red.push(found.name)
      } catch (error) {
        log(`Could not read CI of ${pr.url}: ${String(error)}`)
      }
    }
    return red
  }

  /**
   * Merges into one repo run one at a time (T276): each one moves the base the next one merges
   * into, and GitHub turns a merge away while its base is moving.
   */
  const lanes = new Map<string, Promise<void>>()
  function inLane(repoPath: string, job: () => Promise<void>): Promise<void> {
    const turn = (lanes.get(repoPath) ?? Promise.resolve()).then(job)
    lanes.set(
      repoPath,
      turn.catch(() => {}),
    )
    return turn
  }

  /** One PR through its forge, asked again when the base moved under it — somebody else merged. */
  async function mergeThroughForge(service: GitService, repoPath: string, url: string): Promise<void> {
    for (const wait of [...BASE_MOVED_WAITS_MS, null]) {
      try {
        return await service.mergePullRequest({ repoPath, url })
      } catch (error) {
        if (wait === null || !BASE_MOVED.test(error instanceof Error ? error.message : String(error))) throw error
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
    }
  }

  /** Merges the PRs not merged yet, then removes the worktrees and moves the ticket to Done. */
  function startMerge(review: Review): void {
    if (!git) throw new Error('There is no git service to merge with')
    const refusal = refusedMerge(review.ticketId)
    if (refusal) return void refuseMerge(review, refusal)
    // Whatever the autonomy level, and whoever pressed it: nothing merges while Testing has not
    // passed. An approval that waited through a failed attempt lands here and is answered in words.
    const waiting = security?.refusal(review.ticketId) ?? tests?.refusal(review.ticketId)
    if (waiting) return void announce(waiting, review)
    const service = git
    setMerge(review.id, 'merging')
    void (async () => {
      const row = ticket(review.ticketId)
      if (!row) return
      const done = new Set(mergedRepoIds(row.id))
      const pulls = code.of(row.id).pullRequests
      for (const pr of pulls.filter((p) => !done.has(p.repoId))) {
        const found = repo(pr.repoId)
        try {
          if (!found) throw new Error('the repo was removed from the Company')
          await inLane(found.path, () => mergeThroughForge(service, found.path, pr.url))
        } catch (error) {
          if (!db.isOpen) return
          const reason = error instanceof Error ? error.message : String(error)
          log(`Could not merge ${pr.url}: ${reason}`)
          setMerge(review.id, 'failed', reason)
          announce(
            `Could not merge ${subjectOf(row)} in ${repoName(pr.repoId)}: ${reason} ` +
              'Bring the branch up to date with its base and push, then call merge_retry; ' +
              'the boss can also press Retry merge on the ticket.',
          )
          // A post in #prs wakes nobody, and a failed merge left alone is a PR nobody merges: the
          // ticket's holder is the one who can bring its branch up to date (T277).
          if (row.assignee_id !== null && row.assignee_id !== BOSS) {
            deliver({
              employeeId: row.assignee_id,
              kind: 'review',
              fromId: COMPANY_AUTHOR,
              channelId: PRS_CHANNEL,
              threadId: review.messageId,
              messageId: null,
              ticketId: row.id,
              text: `Could not merge ${subjectOf(row)}: ${reason}`,
              prompt:
                `[company] ${idOf(row.id)} ${JSON.stringify(row.title)} is approved, but merging it in ` +
                `${repoName(pr.repoId)} failed: ${JSON.stringify(reason)}. Bring your branch up to date with its ` +
                'base — merge the base in and resolve any conflict — and push, then call merge_retry for ' +
                `${idOf(row.id)}. Never merge the PR yourself.`,
            })
          }
          return
        }
        if (!db.isOpen) return
        db.prepare('INSERT INTO merged_pull_request (ticket_id, repo_id, merged_at) VALUES (?, ?, ?)').run(
          row.id,
          pr.repoId,
          new Date().toISOString(),
        )
        onChange()
      }
      const kept: string[] = []
      // Only what merged is cleaned up. A repo the merge never touched — a `local only` one in a
      // ticket that also spans a repo TinyCorp may merge — keeps its branch and its worktree, which
      // is the whole of what `local only` promises (decision 61).
      const landed = new Set(mergedRepoIds(row.id))
      const unmerged = code.of(row.id).worktrees.filter((w) => !landed.has(w.repoId))
      for (const w of code.of(row.id).worktrees.filter((w) => landed.has(w.repoId))) {
        const found = repo(w.repoId)
        try {
          if (found) await service.removeWorktree({ repoPath: found.path, path: w.path, branch: w.branch })
          if (!db.isOpen) return
          code.worktreeRemoved(row.id, w.repoId)
        } catch (error) {
          if (!db.isOpen) return
          log(`Could not remove the worktree ${w.path}: ${String(error)}`)
          kept.push(w.path)
        }
      }
      setMerge(review.id, 'merged')
      onReviewEvent?.({
        kind: 'merged',
        ticketId: row.id,
        title: row.title,
        repos: pulls.map((p) => repoName(p.repoId)),
        actorId: review.decidedBy ?? BOSS,
      })
      if (ticket(row.id)?.column_id !== 'done') board(BOSS).moveTicket(row.id, 'done')
      const left = unmerged.map((w) => `${repoName(w.repoId)}: ${w.path}`).join(', ')
      announce(
        `Merged ${subjectOf(row)}: ${prList(pulls)}. ` +
          (kept.length > 0 ? `Could not remove ${kept.join(', ')}; ` : 'Worktrees removed; ') +
          `${idOf(row.id)} is done.` +
          (left ? ` Nothing was merged in ${left}, so that worktree stays for you.` : ''),
      )
    })().catch((error: unknown) => log(`Merging ${idOf(review.ticketId)} failed: ${String(error)}`))
  }

  /** The round's merge Approval while the boss has not decided it, so acting on the ticket decides it too. */
  function pendingApproval(review: Review): number | null {
    if (review.merge !== 'waiting' || review.approvalId === null) return null
    const pending = approvals.list({ status: 'pending' }).some((a) => a.id === review.approvalId)
    return pending ? review.approvalId : null
  }

  function requireComments(value: unknown, required: boolean): string {
    const text = typeof value === 'string' ? value.trim() : ''
    if (required && !text) throw new Error('Requesting changes needs comments')
    return text
  }

  const reviews: CompanyReviews = {
    of: latest,

    list() {
      const rows = db
        .prepare('SELECT * FROM review WHERE id IN (SELECT MAX(id) FROM review GROUP BY ticket_id) ORDER BY ticket_id')
        .all() as unknown as ReviewRow[]
      return rows.map(toReview)
    },

    approve(ticketId, comments) {
      const row = reviewable(ticketId)
      if (!git) throw new Error('There is no git service to merge with')
      const review = openRound(row)
      const text = requireComments(comments, false)
      const approvalId = pendingApproval(review)
      if (approvalId !== null) {
        approvals.decide(approvalId, { approve: true, ...(text && { reason: text }) })
        return round(review.id)
      }
      if (review.status === 'approved') {
        startMerge(review)
        return round(review.id)
      }
      return decide(review, BOSS, 'approve', text)
    },

    requestChanges(ticketId, comments) {
      const row = reviewable(ticketId)
      const text = requireComments(comments, true)
      const review = openRound(row)
      const approvalId = pendingApproval(review)
      if (approvalId !== null) {
        approvals.decide(approvalId, { approve: false, reason: text })
        return round(review.id)
      }
      return decide(review, BOSS, 'request_changes', text)
    },

    as(employeeId) {
      return {
        of: latest,
        threads: (ticketId) => threads.list(ticketId),
        thread: (threadId) => threads.get(threadId),
        assigneeOf: (ticketId) => ticket(ticketId)?.assignee_id ?? null,
        openThread: (input) => threads.open(input, employeeId),
        replyInThread: (input) => threads.reply(input, employeeId),
        setThreadState: (threadId, state) => threads.setState(threadId, state, employeeId),
        submit({ ticketId, verdict, comments }) {
          if (verdict !== 'approve' && verdict !== 'request_changes') {
            throw new Error('The verdict must be "approve" or "request_changes"')
          }
          reviewable(ticketId)
          const review = latest(ticketId)
          if (review?.status !== 'pending') throw new Error(`${idOf(ticketId)} is not waiting for a review`)
          if (review.reviewerId !== employeeId) {
            throw new Error(`The review of ${idOf(ticketId)} is for ${nameOf(review.reviewerId)}, not you`)
          }
          // An approval with a blocking thread still open is a contradiction: resolve it, or say it
          // is a note. Notes may stay open, which is the whole point of them (T170).
          const open = verdict === 'approve' ? blockingThreads(threads.list(ticketId)) : []
          if (open.length > 0) {
            throw new Error(
              `${open.length} ${open.length === 1 ? 'thread is' : 'threads are'} still open on ${idOf(ticketId)}: ` +
                `${open.map((thread) => `#${thread.id} ${threadAnchor(thread)}`).join(', ')}. ` +
                'Resolve each with review_resolve, or leave it as a non-blocking note, then approve.',
            )
          }
          const text = requireComments(comments, verdict === 'request_changes')
          return decide(review, employeeId, verdict, text)
        },

        retryMerge(ticketId) {
          reviewable(ticketId)
          const review = latest(ticketId)
          if (review?.status !== 'approved' || review.merge !== 'failed') {
            throw new Error(`${idOf(ticketId)} has no failed merge to try again`)
          }
          forwardMerge(review, employeeId)
          return round(review.id)
        },

        ready({ ticketId, summary = '' }) {
          const row = ticket(ticketId)
          if (!row) throw new Error(`There is no ticket ${idOf(ticketId)}`)
          if (row.assignee_id !== employeeId) throw new Error(`${idOf(ticketId)} is not yours`)
          const before = latest(ticketId)
          if (before?.status === 'pending') throw new Error(`${idOf(ticketId)} is already waiting for a review`)
          // Moving to Review is what starts the next round, through the code flow, once every PR is
          // open; a ticket already there starts one here. Either way the note travels with it.
          // Through the code flow's own board, the one an Employee moves a ticket with: entering
          // Review is what opens any missing PR and starts the round, inside this same call.
          withHandback(summary, () => {
            if (row.column_id !== 'review') code.boardAs(employeeId).moveTicket(ticketId, 'review')
            else reviews.readyForReview(ticketId)
          })
          const started = latest(ticketId)
          if (!started || started.id === before?.id || started.status !== 'pending') {
            throw new Error(
              `${idOf(ticketId)} is in review, but no round could start yet: its PRs are not all open. ` +
                'Push your branches and open the missing PRs first.',
            )
          }
          return started
        },
      }
    },

    testingPassed(ticketId) {
      resume(ticketId)
    },

    securityCleared(ticketId) {
      resume(ticketId)
    },

    readyForReview(ticketId) {
      const row = ticket(ticketId)
      if (!row || row.column_id !== 'review') return
      const last = latest(ticketId)
      if (last && (last.status === 'pending' || (last.status === 'approved' && UNDER_WAY.includes(last.merge)))) {
        return
      }
      // An approved round whose merge the security pass is holding is not a round that needs
      // reviewing again: the ticket is where it was, waiting on the pass (T241).
      if (last?.status === 'approved' && security?.refusal(ticketId)) return
      startRound(row, routing.reviewer(row.assignee_id ?? BOSS))
    },

    decided(approval) {
      if (approval.action !== 'merge') return
      const row = db.prepare('SELECT * FROM review WHERE approval_id = ?').get(approval.id) as ReviewRow | undefined
      if (!row) return retriedByApproval(approval)
      if (row.merge !== 'waiting') return
      const review = toReview(row)
      if (approval.status === 'approved') {
        const column = ticket(review.ticketId)?.column_id
        if (column !== 'review' && column !== 'testing') return void setMerge(review.id, null)
        return startMerge(review)
      }
      if (approval.status !== 'rejected') return
      setMerge(review.id, 'rejected')
      const ticketRow = ticket(review.ticketId)
      if (ticketRow) bounce(ticketRow, BOSS, approval.decisionReason ?? '')
    },
  }
  return reviews
}
