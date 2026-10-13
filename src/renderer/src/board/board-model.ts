import type { Approval } from '../../../shared/approvals'
import type { TicketCode } from '../../../shared/code'
import type { BoardSnapshot, Epic, Ticket } from '../../../shared/domain/board'
import {
  type Plan,
  type PlanChip,
  planChip,
  waitsOnBoss as planWaitsOnBoss,
  questionCount,
} from '../../../shared/planning/planning'
import type { Review } from '../../../shared/review'
import { canOpenReview } from '../../../shared/review/review-entry'
import { type SecurityChip, type SecurityPass, securityChip } from '../../../shared/review/security'
import type { SessionStatus } from '../../../shared/session'
import { type TestChip, type TestRun, testChip, testerChip } from '../../../shared/testing'
import { ticketCode, worktreeLabel } from '../../../shared/ticket-id'
import { openBlockers } from '../../../shared/ticket-links'
import { parseTicketRefs } from '../../../shared/ticket-refs'
import type { BoardFilter, Route } from '../chrome'

/** What the board reads besides the snapshot to decorate its cards. */
export interface BoardFacts {
  /** Session status by Employee id. */
  sessions: Record<string, SessionStatus>
  /** The Company key the cards' ids carry, `TC` in `TC-142`; absent until the Company is read. */
  companyKey?: string
  /** Pending approvals. */
  approvals: Approval[]
  reviews: Review[]
  code: TicketCode[]
  /** The newest version of every plan in the Company (T171); empty until they are read. */
  plans: Plan[]
  /** The latest test attempt of every ticket that has one (T174); empty until they are read. */
  tests: TestRun[]
  /** The latest security pass of every ticket that has one (T241); empty until they are read. */
  security: SecurityPass[]
}

/**
 * The badge a card carries about its security pass (T241): who is reading it, what it found, and
 * whether the merge is waiting on it. It stays on the card after the ticket merges, because a pass
 * the boss overrode is a thing the board should keep saying.
 */
export function securityChipOf(
  ticket: Pick<Ticket, 'id'>,
  facts: Pick<BoardFacts, 'security'>,
  employeeName: (id: string) => string,
): SecurityChip | null {
  const pass = facts.security.find((entry) => entry.ticketId === ticket.id)
  if (!pass) return null
  return securityChip(pass, employeeName(pass.reviewerId))
}

/**
 * The chip a card carries about its test (T174, frame `YatUW` card a): who holds it and how far it
 * got. It is drawn while the ticket is in Testing, and stays on the card once a test failed — the
 * ticket is back in Doing then, and the chip is why.
 */
export function testChipOf(
  ticket: Pick<Ticket, 'id' | 'column'>,
  facts: Pick<BoardFacts, 'tests'>,
  employeeName: (id: string) => string,
): (TestChip & { tester: string | null }) | null {
  const run = facts.tests.find((entry) => entry.ticketId === ticket.id)
  if (!run) return null
  if (ticket.column !== 'testing' && run.state !== 'failed') return null
  const agentName = run.agentId ? employeeName(run.agentId) : null
  return { ...testChip(run, agentName), tester: testerChip(run, agentName) }
}

/** The badge at the foot of a card. */
export type TicketStatus = 'working' | 'waiting' | 'blocked' | 'review' | 'merged'

export const STATUS_LABEL: Record<TicketStatus, string> = {
  working: 'Working',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
  review: 'In review',
  merged: 'Merged',
}

/** Which part of the board is shown: every ticket, one Target's (through its epics) or one Epic's. */
export type BoardScope = { kind: 'all' } | { kind: 'target'; id: number } | { kind: 'epic'; id: number }

/** The sidebar's Views: tickets waiting on the boss, blocked tickets, open tickets with a PR. */
export const FILTER_LABEL: Record<BoardFilter, string> = {
  'my-approvals': 'My approvals',
  blocked: 'Blocked',
  'open-prs': 'Open PRs',
}

export interface BoardSelection {
  scope: BoardScope
  view: BoardFilter | null
  /** An Employee id, `null` for unclaimed tickets; absent shows everyone's. */
  assignee?: string | null
}

/** The ticket's latest review round, the one the drawer and the card read. */
export function latestReview(ticketId: number, facts: BoardFacts): Review | undefined {
  let latest: Review | undefined
  for (const review of facts.reviews) {
    if (review.ticketId === ticketId && (!latest || review.id > latest.id)) latest = review
  }
  return latest
}

function waitsOnBoss(ticketId: number, facts: BoardFacts): boolean {
  return facts.approvals.some(
    (approval) =>
      approval.status === 'pending' && parseTicketRefs(approval.subject, facts.companyKey ?? '').includes(ticketId),
  )
}

/** The newest version of a ticket's plan, or undefined when it has none (T171). */
export function planOf(ticketId: number, facts: BoardFacts): Plan | undefined {
  return facts.plans.find((plan) => plan.ticketId === ticketId)
}

/** The newest version of an epic's plan, or undefined when it has none. */
export function epicPlanOf(epicId: number, facts: BoardFacts): Plan | undefined {
  return facts.plans.find((plan) => plan.epicId === epicId)
}

/**
 * The chip a card carries about its plan (frame `Oumw5`): the Planning column's state chips, and
 * `Plan approved` once the ticket is Ready. Null anywhere else.
 */
export function planLabel(ticket: Ticket, facts: BoardFacts, plannerName: (id: string) => string): PlanChip | null {
  const plan = planOf(ticket.id, facts)
  if (!plan) return null
  if (ticket.column === 'planning') return planChip(plan, plannerName(plan.plannerId))
  if (ticket.column === 'todo' && plan.status === 'approved') return { tone: 'approved', text: 'Plan approved' }
  return null
}

/** `Q 2/3` on a Planning card: how many of its questions the boss has answered. */
export function planQuestions(ticket: Ticket, facts: BoardFacts): string | null {
  const plan = planOf(ticket.id, facts)
  return plan && ticket.column === 'planning' ? questionCount(plan) : null
}

/** How many plans in a column have something on the boss's desk: the head's `2 need you`. */
export function needYou(tickets: Ticket[], facts: BoardFacts): number {
  return tickets.filter((ticket) => {
    const plan = planOf(ticket.id, facts)
    return plan !== undefined && planWaitsOnBoss(plan)
  }).length
}

/** The epics the Planning column draws a card for: the ones whose plan is not approved yet. */
export function planningEpics(board: BoardSnapshot, facts: BoardFacts, selection: BoardSelection): Epic[] {
  const scope = resolveScope(board, selection.scope)
  return board.epics.filter((epic) => {
    const plan = epicPlanOf(epic.id, facts)
    if (!plan || plan.status === 'approved') return false
    if (selection.view !== null) return planWaitsOnBoss(plan)
    if (scope.kind === 'epic') return epic.id === scope.id
    if (scope.kind === 'target') return epic.targetId === scope.id
    return true
  })
}

/** The ticket's worktrees and PRs, as the board already reads them for its cards. */
export function codeOf(ticketId: number, facts: BoardFacts): TicketCode | undefined {
  return facts.code.find((c) => c.ticketId === ticketId)
}

/** The state a card shows, from the strongest fact down; null shows no badge. */
export function ticketStatus(ticket: Ticket, facts: BoardFacts): TicketStatus | null {
  const review = latestReview(ticket.id, facts)
  if (review?.merge === 'merged') return 'merged'
  if (ticket.blocked) return 'blocked'
  if (waitsOnBoss(ticket.id, facts)) return 'waiting'
  if (review?.status === 'pending') return 'review'
  if (ticket.column === 'doing' && ticket.assigneeId && facts.sessions[ticket.assigneeId] === 'busy') {
    return 'working'
  }
  return null
}

export interface CardFacts {
  /** `wt/TC-142` while a ticket with a worktree is in Doing (the design shows it there only). */
  worktree: string | null
  /** PR numbers, one per repo that has a PR. */
  pullRequests: number[]
  /** Whether the card offers the Review screen; a PR is not required for it (T82). */
  canReview: boolean
}

/** How a card, the editor and the search row name a ticket: `TC-142` (decision 33). */
export function ticketLabel(ticketId: number, facts: Pick<BoardFacts, 'companyKey'>): string {
  return ticketCode(facts.companyKey ?? '', ticketId)
}

export function cardFacts(ticket: Ticket, facts: BoardFacts): CardFacts {
  const code = codeOf(ticket.id, facts)
  return {
    worktree:
      ticket.column === 'doing' && code && code.worktrees.length > 0
        ? worktreeLabel(facts.companyKey ?? '', ticket.id)
        : null,
    pullRequests: (code?.pullRequests ?? []).flatMap((pr) => (pr.number === null ? [] : [pr.number])),
    canReview: canOpenReview(ticket, code),
  }
}

function targetOf(ticket: Ticket, board: BoardSnapshot): number | null {
  return board.epics.find((e) => e.id === ticket.epicId)?.targetId ?? null
}

function inScope(ticket: Ticket, board: BoardSnapshot, scope: BoardScope): boolean {
  switch (scope.kind) {
    case 'all':
      return true
    case 'target':
      return targetOf(ticket, board) === scope.id
    case 'epic':
      return ticket.epicId === scope.id
  }
}

function inView(ticket: Ticket, facts: BoardFacts, view: BoardFilter): boolean {
  switch (view) {
    case 'my-approvals': {
      const plan = planOf(ticket.id, facts)
      return waitsOnBoss(ticket.id, facts) || (plan !== undefined && planWaitsOnBoss(plan))
    }
    case 'blocked':
      return ticket.blocked
    case 'open-prs':
      return ticket.column !== 'done' && (codeOf(ticket.id, facts)?.pullRequests.length ?? 0) > 0
  }
}

type BoardRoute = Extract<Route, { view: 'board' }>

/** The selection a shell route names: a filter, else an Epic or a Target, else every ticket. */
export function selectionOf(route: BoardRoute): BoardSelection {
  if (route.filter) return { scope: { kind: 'all' }, view: route.filter }
  if (route.epicId !== undefined) return { scope: { kind: 'epic', id: route.epicId }, view: null }
  if (route.targetId !== undefined) return { scope: { kind: 'target', id: route.targetId }, view: null }
  return { scope: { kind: 'all' }, view: null }
}

/** The shell route for a scope picked in the board header. */
export function routeOf(scope: BoardScope): BoardRoute {
  switch (scope.kind) {
    case 'all':
      return { view: 'board' }
    case 'target':
      return { view: 'board', targetId: scope.id }
    case 'epic':
      return { view: 'board', epicId: scope.id }
  }
}

/** A scope pointing at a Target or Epic that no longer exists shows every ticket. */
export function resolveScope(board: BoardSnapshot, scope: BoardScope): BoardScope {
  if (scope.kind === 'target' && !board.targets.some((t) => t.id === scope.id)) return { kind: 'all' }
  if (scope.kind === 'epic' && !board.epics.some((e) => e.id === scope.id)) return { kind: 'all' }
  return scope
}

/** The tickets the board shows for a selection, in snapshot order. */
export function visibleTickets(board: BoardSnapshot, facts: BoardFacts, selection: BoardSelection): Ticket[] {
  const scope = resolveScope(board, selection.scope)
  return board.tickets.filter(
    (ticket) =>
      inScope(ticket, board, scope) &&
      (selection.view === null || inView(ticket, facts, selection.view)) &&
      (selection.assignee === undefined || ticket.assigneeId === selection.assignee),
  )
}

export function scopeTitle(
  board: BoardSnapshot,
  selection: BoardSelection,
): { title: string; badge: 'Target' | 'Epic' | 'View' | null } {
  if (selection.view) return { title: FILTER_LABEL[selection.view], badge: 'View' }
  const scope = resolveScope(board, selection.scope)
  if (scope.kind === 'target') {
    return { title: board.targets.find((t) => t.id === scope.id)!.title, badge: 'Target' }
  }
  if (scope.kind === 'epic') {
    return { title: board.epics.find((e) => e.id === scope.id)!.title, badge: 'Epic' }
  }
  return { title: 'All tickets', badge: null }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** The header subtitle: `12 tickets · 2 epics · WIP limits enforced on Doing and Review`. */
export function boardMeta(board: BoardSnapshot, tickets: Ticket[]): string {
  const epics = new Set(tickets.flatMap((t) => (t.epicId === null ? [] : [t.epicId])))
  const limited = board.columns.filter((c) => c.wipLimit !== null).map((c) => c.title)
  const wip =
    limited.length === 0
      ? 'No WIP limits'
      : `WIP ${limited.length === 1 ? 'limit' : 'limits'} enforced on ${
          limited.length === 1 ? limited[0] : `${limited.slice(0, -1).join(', ')} and ${limited.at(-1)}`
        }`
  return [plural(tickets.length, 'ticket'), plural(epics.size, 'epic'), wip].join(' · ')
}

/**
 * The link chips a card carries (T266, frame `IziV6`): what it waits on, while any of it is not
 * Done, and what waits on it, while it is not Done itself. Ids only; the card writes them.
 */
export function linkChipsOf(
  ticket: Pick<Ticket, 'column' | 'blockedBy' | 'blocks'>,
  tickets: readonly Pick<Ticket, 'id' | 'column' | 'blockedBy'>[],
): { waitsOn: number[]; blocks: number[] } {
  const waitsOn = openBlockers(ticket, tickets).map((t) => t.id)
  const blocks =
    ticket.column === 'done'
      ? []
      : ticket.blocks.filter((id) => tickets.some((t) => t.id === id && t.column !== 'done'))
  return { waitsOn, blocks }
}
