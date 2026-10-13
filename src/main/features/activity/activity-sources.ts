import type { ActivityBadge, ActivitySubject } from '../../../shared/activity'
import { ACTION_LABEL, type Approval, type ApprovalOutcome } from '../../../shared/approvals'
import type { CapacityInfo } from '../../../shared/capacity'
import { COLUMN_TITLES, type Column, type Ticket } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, dmMembers, type Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { StaffingOutcome, StaffingRequest } from '../../../shared/hiring'
import type { Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import { ticketCode } from '../../../shared/ticket-id'
import { unblockedBy } from '../../../shared/ticket-links'
import type { CompanyApprovals } from '../approvals'
import type { LocalMergeResult } from '../code'
import type { CompanyHiring } from '../hiring'
import type { OpenedPullRequest } from '../notifications'
import type { RepoRegistry } from '../repos'
import type { CompanyReviews } from '../review'
import type { Capacity, SessionActivity, TicketWakes } from '../sessions'
import type { ActivityLog } from './activity'

/**
 * What every recorder needs to write a readable line. Recorders take it as a function, so a
 * renamed boss or a freshly hired Employee reads right in the next event.
 */
export interface ActivityContext {
  log: ActivityLog
  /** The Company key, so ticket ids read `TC-318` (decision 33). */
  companyKey: string
  /** The name of the boss, an Employee or a former one; `System` for the app itself. */
  nameOf(actorId: string): string
}

const PENDING: ActivityBadge = { label: 'Pending', tone: 'warning' }
const NEEDS_REVIEW: ActivityBadge = { label: 'Needs review', tone: 'primary' }
const MERGED: ActivityBadge = { label: 'Merged', tone: 'success' }
const PAUSED: ActivityBadge = { label: 'Paused', tone: 'danger' }

function ticketSubjectOf(key: string, ticket: { id: number; title: string }): ActivitySubject {
  return { kind: 'ticket', id: `${ticket.id}`, label: ticketCode(key, ticket.id) }
}

/**
 * The board as one participant uses it, writing what they did to the activity log.
 * Wraps `TicketWakes` so every board caller — the boss, an Employee over MCP, the review flow —
 * records without knowing about the log.
 */
export function recordingWakes(wakes: TicketWakes, context: () => ActivityContext): TicketWakes {
  return {
    ...wakes,
    boardAs(actorId) {
      const board = wakes.boardAs(actorId)
      const actor = () => ({ actorId, actorName: context().nameOf(actorId) })
      const code = (ticket: Ticket) => ticketCode(context().companyKey, ticket.id)
      return {
        ...board,

        createEpic(input) {
          const epic = board.createEpic(input)
          context().log.record({
            ...actor(),
            kind: 'epic_created',
            summary: `created the epic ${epic.title}`,
            code: [epic.title],
            payload: { epicId: epic.id },
          })
          return epic
        },

        createTicket(input) {
          const ticket = board.createTicket(input)
          context().log.record({
            ...actor(),
            kind: 'ticket_created',
            summary: `created ${code(ticket)}`,
            subject: ticketSubjectOf(context().companyKey, ticket),
            detail: ticket.title,
            code: [code(ticket)],
            payload: { ticketId: ticket.id, column: ticket.column },
          })
          if (ticket.assigneeId) recordAssignment(ticket)
          return ticket
        },

        updateTicket(id, changes) {
          const ticket = board.updateTicket(id, changes)
          if (changes.assigneeId !== undefined && ticket.assigneeId) recordAssignment(ticket)
          return ticket
        },

        moveTicket(id, column, index) {
          // Only a move into Done can set a ticket free, so only that one reads the board first.
          const wasDone = column === 'done' && board.snapshot().tickets.some((t) => t.id === id && t.column === 'done')
          const ticket = board.moveTicket(id, column, index)
          context().log.record({
            ...actor(),
            kind: 'ticket_moved',
            summary: moveSummary(code(ticket), column),
            subject: ticketSubjectOf(context().companyKey, ticket),
            detail: ticket.title,
            code: [code(ticket), ...(column === 'done' ? [] : [COLUMN_TITLES[column]])],
            payload: { ticketId: ticket.id, column },
          })
          if (column === 'done' && !wasDone && ticket.blocks.length > 0) {
            for (const freed of unblockedBy(ticket, board.snapshot().tickets)) {
              context().log.record({
                ...actor(),
                kind: 'ticket_unblocked',
                summary: `closed ${code(ticket)}, the last blocker of ${code(freed)}, so it no longer waits`,
                subject: ticketSubjectOf(context().companyKey, freed),
                detail: freed.title,
                code: [code(ticket), code(freed)],
                payload: { ticketId: freed.id, blockedById: ticket.id },
              })
            }
          }
          return ticket
        },
      }

      function recordAssignment(ticket: Ticket): void {
        context().log.record({
          ...actor(),
          kind: 'ticket_assigned',
          summary: `assigned ${code(ticket)} to ${context().nameOf(ticket.assigneeId!)}`,
          subject: ticketSubjectOf(context().companyKey, ticket),
          detail: ticket.title,
          code: [code(ticket)],
          payload: { ticketId: ticket.id, assigneeId: ticket.assigneeId },
        })
      }
    },
  }
}

function moveSummary(code: string, column: Column): string {
  return column === 'done' ? `closed ${code}` : `moved ${code} to ${COLUMN_TITLES[column]}`
}

/** Approvals that write both the request and the boss's decision to the log. */
export function recordingApprovals(approvals: CompanyApprovals, context: () => ActivityContext): CompanyApprovals {
  return {
    ...approvals,

    request(input) {
      const outcome: ApprovalOutcome = approvals.request(input)
      if (outcome.gate !== 'ask') return outcome
      const { approval } = outcome
      context().log.record({
        kind: 'approval_requested',
        actorId: approval.requesterId,
        actorName: context().nameOf(approval.requesterId),
        summary: `asked to ${ACTION_LABEL[approval.action]} ${approval.subject}`,
        subject: { kind: 'approval', id: `${approval.id}`, label: approval.subject },
        detail: approval.reason || null,
        badge: PENDING,
        payload: { approvalId: approval.id, action: approval.action },
      })
      return outcome
    },

    decide(id, decision) {
      const approval = approvals.decide(id, decision)
      context().log.record({
        kind: 'approval_decided',
        actorId: BOSS,
        actorName: context().nameOf(BOSS),
        summary: `${approval.status === 'approved' ? 'approved' : 'sent back'} ${approval.subject}`,
        subject: { kind: 'approval', id: `${approval.id}`, label: approval.subject },
        detail: approval.decisionReason || null,
        payload: { approvalId: approval.id, action: approval.action, status: approval.status },
      })
      return approval
    },
  }
}

/** Hiring that writes proposals, hires and fires to the log. */
export function recordingHiring(hiring: CompanyHiring, context: () => ActivityContext): CompanyHiring {
  function staffed(outcome: StaffingOutcome, requesterId: string): StaffingOutcome {
    if (outcome.status === 'pending') {
      recordProposal(context, outcome.request, requesterId)
      return outcome
    }
    recordStaffChange(context, outcome.request.kind, outcome.employee, requesterId)
    return outcome
  }

  return {
    ...hiring,
    requestHire: (input) => staffed(hiring.requestHire(input), input.requesterId),
    requestFire: (input) => staffed(hiring.requestFire(input), input.requesterId),
    fire(employeeId, reason) {
      const employee = hiring.fire(employeeId, reason)
      recordStaffChange(context, 'fire', employee, BOSS)
      return employee
    },
    rehire(employeeId) {
      const employee = hiring.rehire(employeeId)
      recordStaffChange(context, 'hire', employee, BOSS)
      return employee
    },
  }
}

function recordProposal(context: () => ActivityContext, request: StaffingRequest, requesterId: string): void {
  const who = request.proposal?.name ?? (request.employeeId ? context().nameOf(request.employeeId) : 'someone')
  context().log.record({
    kind: 'hire_proposed',
    actorId: requesterId,
    actorName: context().nameOf(requesterId),
    summary: request.kind === 'hire' ? `proposed hiring ${who}` : `proposed letting ${who} go`,
    detail: request.reason || null,
    code: [who],
    badge: PENDING,
    payload: { requestId: request.id, kind: request.kind },
  })
}

function recordStaffChange(
  context: () => ActivityContext,
  kind: 'hire' | 'fire',
  employee: Employee,
  actorId: string,
): void {
  context().log.record({
    kind: kind === 'hire' ? 'employee_hired' : 'employee_fired',
    actorId,
    actorName: context().nameOf(actorId),
    summary: kind === 'hire' ? `hired ${employee.name}` : `let ${employee.name} go`,
    subject: { kind: 'employee', id: employee.id, label: employee.name },
    detail: employee.title,
    code: [employee.name],
    payload: { employeeId: employee.id },
  })
}

/**
 * The hire or fire a decided Approval carried out, once the hiring flow has run it.
 * The Approval itself is already in the log; this is the staff change behind it.
 */
export function recordDecidedStaffing(
  hiring: CompanyHiring,
  context: () => ActivityContext,
  approval: Approval,
  employeeName: (employeeId: string) => Employee | null,
): void {
  if (approval.status !== 'approved' || (approval.action !== 'hire' && approval.action !== 'fire')) return
  const request = hiring.requests().find((r) => r.approvalId === approval.id)
  if (!request || request.status !== 'done' || !request.employeeId) return
  const employee = employeeName(request.employeeId)
  if (!employee) return
  recordStaffChange(context, request.kind, employee, approval.requesterId)
}

/** Reviews that write each verdict to the log; merges come from the flow's own hook. */
export function recordingReviews(reviews: CompanyReviews, context: () => ActivityContext): CompanyReviews {
  function verdict(review: Review, actorId: string): Review {
    const label = ticketCode(context().companyKey, review.ticketId)
    context().log.record({
      kind: 'review_submitted',
      actorId,
      actorName: context().nameOf(actorId),
      summary: `${review.status === 'approved' ? 'approved' : 'requested changes on'} ${label}`,
      subject: { kind: 'ticket', id: `${review.ticketId}`, label },
      detail: review.comments || null,
      code: [label],
      payload: { ticketId: review.ticketId, status: review.status },
    })
    return review
  }

  return {
    ...reviews,
    approve: (ticketId, comments) => verdict(reviews.approve(ticketId, comments), BOSS),
    requestChanges: (ticketId, comments) => verdict(reviews.requestChanges(ticketId, comments), BOSS),
    as(employeeId) {
      const employee = reviews.as(employeeId)
      return { ...employee, submit: (input) => verdict(employee.submit(input), employeeId) }
    },
  }
}

/** The repo registry, writing every newly connected repo to the log. */
export function recordingRepos(repos: RepoRegistry, context: () => ActivityContext): RepoRegistry {
  return {
    ...repos,
    add(input) {
      const repo: Repo = repos.add(input)
      context().log.record({
        kind: 'repo_connected',
        actorId: BOSS,
        actorName: context().nameOf(BOSS),
        summary: `connected repository ${repo.name}`,
        subject: { kind: 'repo', id: repo.id, label: repo.name },
        detail: repo.path,
        code: [repo.name],
        payload: { repoId: repo.id },
      })
      return repo
    },
  }
}

/** Capacity, writing the boss's cap changes to the log. */
export function recordingCapacity(capacity: Capacity, context: () => ActivityContext): Capacity {
  return {
    ...capacity,
    setConcurrencyCap(cap) {
      const info: CapacityInfo = capacity.setConcurrencyCap(cap)
      context().log.record({
        kind: 'concurrency_cap_changed',
        actorId: BOSS,
        actorName: context().nameOf(BOSS),
        summary: `set the concurrency cap to ${info.concurrencyCap}`,
        detail: info.parked.length > 0 ? `${info.parked.length} parked` : null,
        payload: { cap: info.concurrencyCap },
      })
      return info
    },
  }
}

/**
 * A chat post, without its body: the log keeps that a post happened, never what it said.
 * Returns whether it became an event, so the readers of that event run only when it did.
 */
export function recordPost(context: () => ActivityContext, message: Message): boolean {
  if (message.authorId === COMPANY_AUTHOR) return false
  const dm = dmMembers(message.channelId)
  const other = dm?.find((id) => id !== message.authorId) ?? null
  const label = dm ? (other ? context().nameOf(other) : 'a direct message') : `#${message.channelId}`
  context().log.record({
    kind: 'message_posted',
    actorId: message.authorId,
    actorName: context().nameOf(message.authorId),
    summary: dm ? `sent ${label} a direct message` : `posted in ${label}`,
    subject: { kind: 'channel', id: message.channelId, label },
    code: dm ? [] : [label],
    payload: { channelId: message.channelId, threadId: message.threadId, replied: message.threadId !== null },
  })
  return true
}

export function recordPullRequestOpened(context: () => ActivityContext, opened: OpenedPullRequest): void {
  const where = opened.number === null || opened.number === undefined ? opened.repo : `${opened.repo} #${opened.number}`
  const actorId = opened.assigneeId ?? COMPANY_AUTHOR
  context().log.record({
    kind: 'pull_request_opened',
    actorId,
    actorName: context().nameOf(actorId),
    summary: `opened a pull request in ${where}`,
    subject: { kind: 'pull_request', id: `${opened.ticketId}:${opened.repo}`, label: where },
    detail: opened.title,
    code: [where],
    badge: NEEDS_REVIEW,
    payload: { ticketId: opened.ticketId, repo: opened.repo, number: opened.number ?? null },
  })
}

export function recordWorktreeOpened(
  context: () => ActivityContext,
  input: { ticketId: number; title: string; actorId: string; repo: string; branch: string; base: string; path: string },
): void {
  context().log.record({
    kind: 'worktree_opened',
    actorId: input.actorId,
    actorName: context().nameOf(input.actorId),
    summary: `opened a worktree from ${input.base} in ${input.repo}`,
    subject: { kind: 'ticket', id: `${input.ticketId}`, label: ticketCode(context().companyKey, input.ticketId) },
    detail: input.path,
    code: [input.base, input.repo],
    payload: { ticketId: input.ticketId, repo: input.repo, branch: input.branch },
  })
}

/** The boss deleted a ticket that held no work (T275): one line, which is all that is left of it. */
export function recordTicketDeleted(
  context: () => ActivityContext,
  input: { ticketId: number; title: string; actorId: string },
): void {
  context().log.record({
    kind: 'ticket_deleted',
    actorId: input.actorId,
    actorName: context().nameOf(input.actorId),
    summary: `deleted ${ticketCode(context().companyKey, input.ticketId)}`,
    subject: { kind: 'ticket', id: `${input.ticketId}`, label: ticketCode(context().companyKey, input.ticketId) },
    detail: input.title,
    payload: { ticketId: input.ticketId },
  })
}

export function recordReviewRequested(
  context: () => ActivityContext,
  input: { ticketId: number; title: string; reviewerId: string; requesterId: string },
): void {
  const label = ticketCode(context().companyKey, input.ticketId)
  context().log.record({
    kind: 'review_requested',
    actorId: input.requesterId,
    actorName: context().nameOf(input.requesterId),
    summary: `asked ${context().nameOf(input.reviewerId)} to review ${label}`,
    subject: { kind: 'ticket', id: `${input.ticketId}`, label },
    detail: input.title,
    code: [label],
    badge: NEEDS_REVIEW,
    payload: { ticketId: input.ticketId, reviewerId: input.reviewerId },
  })
}

export function recordMerged(
  context: () => ActivityContext,
  input: { ticketId: number; title: string; repos: string[]; actorId: string; local?: boolean },
): void {
  const label = ticketCode(context().companyKey, input.ticketId)
  context().log.record({
    kind: 'merged',
    actorId: input.actorId,
    actorName: context().nameOf(input.actorId),
    summary: `merged ${label}${input.repos.length > 0 ? ` in ${input.repos.join(', ')}` : ''}`,
    subject: { kind: 'ticket', id: `${input.ticketId}`, label },
    detail: input.title,
    code: [label, ...input.repos],
    badge: MERGED,
    payload: { ticketId: input.ticketId, repos: input.repos, local: input.local === true },
  })
}

/** A local merge, as the merge gate reports it (decision 44). */
export function recordLocalMerge(
  context: () => ActivityContext,
  result: LocalMergeResult & { actorId: string; title: string },
): void {
  recordMerged(context, { ...result, local: true })
}

export function recordBudgetExhausted(context: () => ActivityContext, resetsAt: Date | null): void {
  context().log.record({
    kind: 'budget_exhausted',
    actorId: COMPANY_AUTHOR,
    actorName: context().nameOf(COMPANY_AUTHOR),
    summary: 'paused the team: the subscription limit is reached',
    detail: resetsAt ? `The team is in the coffee area until ${resetsAt.toISOString()}` : null,
    badge: PAUSED,
    payload: { resetsAt: resetsAt?.toISOString() ?? null },
  })
}

/**
 * Sessions as the log sees them: one `started` when a Session comes up and one `stopped` when it
 * goes away, out of the stream of status changes and hooks the office also reads.
 */
export function createSessionRecorder(context: () => ActivityContext): (activity: SessionActivity) => void {
  const running = new Set<string>()
  return (activity) => {
    const up = activity.status !== 'off' && activity.status !== 'parked'
    if (up === running.has(activity.employeeId)) return
    if (up) running.add(activity.employeeId)
    else running.delete(activity.employeeId)
    const name = context().nameOf(activity.employeeId)
    context().log.record({
      kind: up ? 'session_started' : 'session_stopped',
      actorId: activity.employeeId,
      actorName: name,
      summary: up ? 'started their Session' : 'stopped their Session',
      subject: { kind: 'session', id: activity.employeeId, label: name },
      payload: { employeeId: activity.employeeId, status: activity.status },
    })
  }
}
