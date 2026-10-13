// What the Chat view shows, derived from engine data. Pure, so the rules are tested without a DOM.

import type { Approval, ApprovalStatus, AutonomyLevel, GatedAction } from '../../../shared/approvals'
import { APPROVAL_KIND_LABEL } from '../../../shared/approvals/approval-summary'
import type { PullRequest, PullRequestDetails, TicketCode } from '../../../shared/code'
import type { BoardSnapshot } from '../../../shared/domain/board'
import { BOSS, type Channel, COMPANY_AUTHOR, dmMembers, type Message } from '../../../shared/domain/chat'
import { type Employee, intakeHolder } from '../../../shared/domain/staff'
import {
  type DailyDigest,
  digestTitle,
  isQuietDigest,
  QUIET_DAY,
  sinceLabel,
} from '../../../shared/planning/daily-digest'
import {
  answersSent,
  type Plan,
  type PlanQuestion,
  type PlanStatus,
  planNextStep,
  unanswered,
} from '../../../shared/planning/planning'
import type { Repo } from '../../../shared/repos/repo'
import type { Review, ReviewHandoff } from '../../../shared/review'
import { reviewTicketOfApproval } from '../../../shared/review/review-entry'
import { openThreadsLabel, type ReviewThread } from '../../../shared/review/review-threads'
import type { TestRun } from '../../../shared/testing'
import { ticketCode, worktreeLabel } from '../../../shared/ticket-id'
import { parseTicketRefs } from '../../../shared/ticket-refs'

/** Everything the view reads besides the messages themselves. */
export interface ChatData {
  /** In hire order. */
  employees: Employee[]
  /** The Company key its ticket ids carry, `TC` in `TC-142`; absent until the Company is read. */
  companyKey?: string
  board: BoardSnapshot | null
  code: TicketCode[]
  repos: Repo[]
  /** Approvals by their thread's root message id. */
  approvals: Map<number, Approval>
  reviews: Review[]
  /** The review threads of the tickets on screen, for the `#prs` card's round line (T170). */
  threads?: ReviewThread[]
  /** The newest version of every plan in the Company (T171); absent until they are read. */
  plans?: Plan[]
  /** The latest test attempt of every ticket that has one (T174); absent until they are read. */
  tests?: TestRun[]
  /** Who answers a message of the boss that mentions nobody, or null when nobody does (decision 41). */
  answererId?: string | null
  /** The boss's name from Company settings; absent until known. */
  bossName?: string
  /** The boss's avatar initials from Company settings. */
  bossInitials?: string
  /** The character the boss picked in Your profile (T79). */
  bossSprite?: number
  /** The zone the Company keeps its digest hours in; absent means this Mac's (T172). */
  digestTimezone?: string | null
}

/** The Company key, or none: `ticketCode` then writes the short `#142` (decision 33). */
export function companyKeyOf(data: ChatData): string {
  return data.companyKey ?? ''
}

/** The mono uppercase tag after a name: `BOSS`, the job title, and `INTAKE` for the intake holder. */
export function roleTag(authorId: string, employees: Employee[]): string {
  if (authorId === BOSS) return 'BOSS'
  if (authorId === COMPANY_AUTHOR) return 'SYSTEM'
  const found = employees.find((e) => e.id === authorId)
  if (!found) return ''
  const title = found.title.toUpperCase()
  return intakeHolder(employees)?.id === found.id ? `${title} · INTAKE` : title
}

/** A display name: `You` for the boss, `tinycorp` for the Company itself. */
export function nameOf(id: string, employees: Employee[]): string {
  if (id === BOSS) return 'You'
  if (id === COMPANY_AUTHOR) return 'tinycorp'
  return employees.find((e) => e.id === id)?.name ?? 'Former employee'
}

export type ListItem = { kind: 'day'; key: string; label: string } | { kind: 'message'; message: Message }

/** The messages with a day divider before the first message of each day. */
export function withDayDividers(messages: Message[], now: Date = new Date()): ListItem[] {
  const items: ListItem[] = []
  let last = ''
  for (const message of messages) {
    const day = dayKey(new Date(message.createdAt))
    if (day !== last) {
      items.push({ kind: 'day', key: `day-${day}`, label: dayLabel(new Date(message.createdAt), now) })
      last = day
    }
    items.push({ kind: 'message', message })
  }
  return items
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

/**
 * When a target is due, as the message that announced it would say it: `today`, a weekday within the
 * week after (`Fri`), and the date beyond that (`Sep 30`, with the year when it is another).
 */
export function dueLabel(day: string, said: Date): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const due = new Date(year, month - 1, date)
  const from = new Date(said.getFullYear(), said.getMonth(), said.getDate())
  const days = Math.round((due.getTime() - from.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days > 0 && days < 7) return due.toLocaleDateString('en-US', { weekday: 'short' })
  return due.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: due.getFullYear() === from.getFullYear() ? undefined : 'numeric',
  })
}

/** `09:05`: 24-hour local time. */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export interface ChannelHeader {
  title: string
  /** The members badge. */
  members: string
  /** Who is in the conversation, the boss first. */
  memberIds: string[]
  topic: string
}

const GENERAL_TOPIC = 'Company-wide. One teammate answers; @mention to ask someone specific.'

/** Where the view goes when the channel it shows is gone: the Company's first channel (T112). */
export const HOME_CHANNEL = 'general'

/**
 * The channel the view shows: the one picked, or `#general` once that one is deleted (T112). A DM
 * stays picked whether or not it is stored, since one opens before its first message; an empty
 * `channels` is a list that has not loaded yet, not a channel that went.
 */
export function visibleChannel(channelId: string, channels: Channel[]): string {
  if (channels.length === 0 || dmMembers(channelId)) return channelId
  return channels.some((c) => c.id === channelId) ? channelId : HOME_CHANNEL
}

export function channelHeader(channelId: string, channels: Channel[], data: ChatData): ChannelHeader {
  const dm = dmMembers(channelId)
  if (dm) {
    const others = dm.filter((m) => m !== BOSS)
    const memberIds = dm.includes(BOSS) ? [BOSS, ...others] : others
    const title = others.map((id) => nameOf(id, data.employees)).join(' ↔ ')
    const other = data.employees.find((e) => e.id === others[0])
    const topic = dm.includes(BOSS)
      ? `${other?.title ?? 'Former employee'} · every message here wakes ${title}.`
      : `Between ${others.map((id) => nameOf(id, data.employees)).join(' and ')}. You can read along.`
    return { title, members: 'Direct message', memberIds, topic }
  }

  const channel = channels.find((c) => c.id === channelId)
  const name = channel?.name ?? channelId
  const epicId = /^epic-(\d+)\b/.exec(name)?.[1]
  const employeeIds = data.employees.map((e) => e.id)
  const members =
    channel && channel.members.length > 0 ? channel.members.filter((m) => employeeIds.includes(m)) : employeeIds
  let topic: string
  // What the boss wrote wins over anything the view could say for itself (T44).
  if (channel?.topic) topic = channel.topic
  else if (channelId === 'general') topic = GENERAL_TOPIC
  else if (epicId !== undefined) {
    const epic = data.board?.epics.find((e) => e.id === Number(epicId))
    topic = epic?.description.trim() || 'Every message here wakes the epic’s members.'
  } else {
    const answerer = answererOf(data)
    topic = answerer
      ? `Everyone reads it. A message from you that mentions nobody goes to ${answerer.name}.`
      : 'Everyone reads it. Mention someone to wake them.'
  }
  return {
    title: `# ${name}`,
    members: `Boss + ${plural(members.length, 'Employee')}`,
    memberIds: [BOSS, ...members],
    topic,
  }
}

/** The page of a channel the view reads, as the engine's own default. */
export const DEFAULT_READ_LIMIT = 50
/** The most the engine will read in one go. */
export const MAX_READ_LIMIT = 200

/**
 * How many messages to read: the usual page, or everything the engine allows while a pin or a
 * search result is being jumped to, since the wanted message may be older than one page (T44). It
 * stays wide until the jump is let go, so a page that finds the message cannot narrow and lose it.
 */
export function readLimitFor(wanted: number | null): number {
  return wanted === null ? DEFAULT_READ_LIMIT : MAX_READ_LIMIT
}

/** The Employee who answers the boss, as the engine resolved it; null when nobody does. */
export function answererOf(data: ChatData): Employee | null {
  return data.employees.find((e) => e.id === data.answererId) ?? null
}

/**
 * The note in place of the composer on a conversation the boss is not in: who to DM to take part.
 * The drawer's read-along shows it for one Employee (T72); the Chat view, opened on a pair from the
 * sidebar's Between agents section, names both (T77).
 */
export function readOnlyNote(names: string[]): string {
  return `Their conversation. DM ${names.join(' or ')} to join in.`
}

/** The hint at the right of the composer: who a message here reaches. */
export function composerHint(channelId: string, data: ChatData): string {
  const dm = dmMembers(channelId)
  if (dm)
    return `${dm
      .filter((m) => m !== BOSS)
      .map((id) => nameOf(id, data.employees))
      .join(', ')} will read it`
  const answerer = answererOf(data)
  if (channelId === 'general') {
    return answerer ? `Everyone reads it · ${answerer.name} will answer` : 'Everyone reads it'
  }
  return answerer ? `${answerer.name} will answer` : 'Mention someone to wake them'
}

export interface TargetEpic {
  id: number
  title: string
  /** Names of the epic's assignees, each once. */
  who: string[]
  tickets: number
}

export type ChipIcon = 'branch' | 'repo' | 'stack'

/** One line of a digest section: a ticket code that opens the ticket, a title and a right-hand note. */
export interface DigestRow {
  /** `TC-138`, or empty for a row that is about no ticket. */
  code: string
  ticketId: number | null
  text: string
  /** The note at the right of the row; empty when there is none. */
  meta: string
  /** The row's PR opens the Review screen for this ticket; null when it has none. */
  reviewTicketId: number | null
  /** The row carries the `Ready for you` badge. */
  ready?: boolean
}

/** One section of the card: its head, and the rows under it. A section with no rows is left out. */
export interface DigestSection {
  id: 'shipped' | 'inReview' | 'blocked' | 'waiting' | 'tomorrow'
  title: string
  /** The count beside the title; null for a section that shows none. */
  count: number | null
  rows: DigestRow[]
}

/** What the daily digest card draws (frame `N47ud`). */
export interface DigestCardView {
  title: string
  since: string
  /** Shipped, In review and Blocked, in the design's order; empty ones are already gone. */
  left: DigestSection[]
  /** Waiting on you and Tomorrow; Usage today sits between them. */
  right: DigestSection[]
  usage: DailyDigest['usage']
  footer: string
  /** The one line a day with nothing in it shows in place of every section. */
  quiet: string | null
}

/**
 * The daily digest as the card draws it: sections with nothing in them are left out here, so the
 * stored digest keeps saying exactly what was true while the card stays short (T172).
 */
export function digestCard(digest: DailyDigest, data: ChatData): DigestCardView {
  const key = companyKeyOf(data)
  const code = (ticketId: number | null) => (ticketId === null ? '' : ticketCode(key, ticketId))
  const section = (id: DigestSection['id'], title: string, rows: DigestRow[], count = true): DigestSection[] =>
    rows.length === 0 ? [] : [{ id, title, count: count ? rows.length : null, rows }]
  return {
    title: digestTitle(digest.until, data.digestTimezone ?? null),
    since: sinceLabel(digest, data.digestTimezone ?? null),
    left: [
      ...section(
        'shipped',
        'Shipped',
        digest.shipped.map((line) => ({
          code: code(line.ticketId),
          ticketId: line.ticketId,
          text: line.title,
          meta: [line.where, line.who].filter(Boolean).join(' · '),
          reviewTicketId: line.ticketId,
        })),
      ),
      ...section(
        'inReview',
        'In review',
        digest.inReview.map((line) => ({
          code: code(line.ticketId),
          ticketId: line.ticketId,
          text: line.title,
          meta: line.where,
          reviewTicketId: line.ticketId,
          ready: line.readyForYou,
        })),
      ),
      ...section(
        'blocked',
        'Blocked',
        digest.blocked.map((line) => ({
          code: code(line.ticketId),
          ticketId: line.ticketId,
          text: line.title,
          meta: line.reason,
          reviewTicketId: null,
        })),
      ),
    ],
    right: [
      ...section(
        'waiting',
        'Waiting on you',
        digest.waiting.map((line) => ({
          code: code(line.ticketId),
          ticketId: line.ticketId,
          text: line.text,
          meta: line.kind,
          reviewTicketId: null,
        })),
      ),
      ...section(
        'tomorrow',
        'Tomorrow',
        digest.tomorrow.map((line) => ({
          code: code(line.ticketId),
          ticketId: line.ticketId,
          text: line.title,
          meta: `Ready · ${line.who}`,
          reviewTicketId: null,
        })),
      ),
    ],
    usage: digest.usage,
    footer: digest.footer,
    quiet: isQuietDigest(digest) ? QUIET_DAY : null,
  }
}

export interface PrLine {
  repo: string
  number: number | null
  url: string
  title: string
}

/** What an approval card's meta facts and the thread panel's detail rows draw as an icon. */
export type ApprovalIcon = 'ticket' | 'repo' | 'who' | 'approved' | 'rejected' | 'note'

export interface ApprovalFact {
  icon: ApprovalIcon
  label: string
}

/** One row of the thread panel's approval detail: a fact with its own note at the right. */
export interface ApprovalRow extends ApprovalFact {
  meta: string
}

/** One numbered question on the planning card, with the answer written under it. */
export interface QuestionLine {
  id: number
  number: number
  text: string
  /** What the boss wrote, the planner's note when they let it decide, or null while open. */
  answer: string | null
  /** Who answered it, as the card names them; null while open. */
  answeredBy: string | null
  delegated: boolean
}

export type MessageCard =
  | {
      kind: 'target'
      targetId: number
      title: string
      /** `Fri`, `today` or `Sep 30`, read from the day of the message that announced it; null when it has none. */
      due: string | null
      epics: TargetEpic[]
      foot: string
    }
  | { kind: 'chips'; chips: { icon: ChipIcon; label: string }[] }
  /** What a QA agent verified before the merge, or the bug a failed step opened (T174, `vKIwf`). */
  | { kind: 'test'; run: TestRun; ticketId: number; ticketLabel: string; agentName: string | null }
  | ({ kind: 'digest' } & DigestCardView)
  | {
      kind: 'pr'
      waiting: boolean
      ticketId: number
      pullRequests: PrLine[]
      /** The latest review round, in words; null before one starts. */
      reviewer: string | null
      replies: number
      /**
       * Where the review stands with the boss (T170): `In review` while the agents are still
       * talking — no decision to make — then `Ready for you` or `Your call`. Null before a round.
       */
      handoff: ReviewHandoff | null
      /** `Round 2 · 1 open thread`, the facts the card carries while a review runs. */
      round: string | null
    }
  | {
      kind: 'approval'
      approvalId: number
      action: GatedAction
      status: ApprovalStatus
      waiting: boolean
      /** `Hire · a new Designer named Iris`. */
      title: string
      /** Why the requester asks, in their words; empty when they gave none. */
      reason: string
      facts: ApprovalFact[]
      replies: number
      /** The ticket whose Review the card offers beside its decisions; null when it offers none. */
      reviewTicketId: number | null
    }
  | {
      kind: 'questions'
      planId: number
      /** Who asked, so the "Let … decide" button can name them. */
      asker: string
      questions: QuestionLine[]
      waiting: boolean
      /**
       * The strip the card ends on once every question is answered and the plan is still to come
       * (frame `dvg9E`): the state, and who it waits on. Null while a question is open, and null
       * once the plan is posted — the Plan card says it then.
       */
      sent: { state: string; by: string } | null
    }
  | {
      kind: 'plan'
      planId: number
      version: number
      status: PlanStatus
      /** `Plan · TC-142 Usage chart with range picker`. */
      title: string
      /** `Draft 1 · by Nova`, or `v1 · approved by you · Tue 09:21`. */
      by: string
      goal: string
      approach: string
      criteria: string[]
      repos: string[]
      subtasks: { title: string; repo: string | null }[]
      risks: string[]
      openQuestions: string[]
      /** What a replan asks for: who, why and what changes. Null on a first draft. */
      replan: { by: string; reason: string; changes: string[] } | null
      /** True while the boss has the decision: the card draws its buttons. */
      waiting: boolean
      /** `Engineers can’t claim it until approved`, or what the plan came to. */
      foot: string
      /** `Plan ready: approve or send back` — what happens next, on the card itself (T233). */
      nextStep: string | null
    }

/**
 * The rich card under a message. An approval or review round about a ticket with PRs gets a PR card;
 * a message that announces a target, or names several tickets of one, gets the target card; a message
 * naming one ticket with a worktree gets its chips.
 */
export function cardOf(message: Message, data: ChatData): MessageCard | null {
  // The digest is the whole message: no approval, no ticket reference, nothing else to look at.
  if (message.digest) return { kind: 'digest', ...digestCard(message.digest, data) }
  // A message about a test attempt is that attempt's card, whatever else its text mentions (T174).
  const run = message.testRunId === undefined ? undefined : (data.tests ?? []).find((r) => r.id === message.testRunId)
  if (run) {
    return {
      kind: 'test',
      run,
      ticketId: run.ticketId,
      ticketLabel: ticketCode(companyKeyOf(data), run.ticketId),
      agentName: run.agentId ? nameOf(run.agentId, data.employees) : null,
    }
  }
  const plans = data.plans ?? []
  const plan = plans.find((p) => p.messageId === message.id)
  if (plan) return planCard(plan, data)
  const asked = plans.find((p) => p.questions.some((q) => q.messageId === message.id))
  if (asked) return questionsCard(asked, message.id, data)
  // The line that opens a planning thread names its ticket; it is a system line, not a code card.
  if (plans.some((p) => p.threadId === message.id) && message.authorId === COMPANY_AUTHOR) return null

  const approval = data.approvals.get(message.id)
  const round = data.reviews.find((r) => r.messageId === message.id)
  if (approval || round) {
    const ticketId = approval ? ticketOfApproval(approval) : round!.ticketId
    const waiting = approval?.status === 'pending'
    const pulls = approval ? pullRequestsOfApproval(approval, data) : undefined
    const card = ticketId === null ? null : prCard(ticketId, message, data, waiting, pulls)
    if (card) return card
    // Every other kind of approval gets the generic card (decision 42); a review round has none.
    return approval ? approvalCard(approval, message, data) : null
  }

  const board = data.board
  // The intake holder's reply to a goal names its target, not its tickets (T151).
  if (board && message.targetId !== undefined && board.targets.some((t) => t.id === message.targetId)) {
    return targetCard(message.targetId, message, data)
  }

  const refs = parseTicketRefs(message.text, companyKeyOf(data))
  if (!board || refs.length === 0) return null
  const tickets = refs.map((id) => board.tickets.find((t) => t.id === id)).filter((t) => t !== undefined)

  if (tickets.length >= 2) {
    const targetOf = (epicId: number | null) => board.epics.find((e) => e.id === epicId)?.targetId ?? null
    const targets = new Set(tickets.map((t) => targetOf(t.epicId)).filter((id) => id !== null))
    const target = targets.size === 1 ? board.targets.find((t) => targets.has(t.id)) : undefined
    if (target) return targetCard(target.id, message, data)
    return null
  }

  const ticket = tickets[0]
  const worktrees = data.code.find((c) => c.ticketId === ticket?.id)?.worktrees ?? []
  if (!ticket || worktrees.length === 0) return null
  const repos = worktrees.map((w) => data.repos.find((r) => r.id === w.repoId)).filter((r) => r !== undefined)
  const stacks = [...new Set(repos.map((r) => [r.stack.packageManager, r.stack.framework].filter(Boolean).join(' + ')))]
  return {
    kind: 'chips',
    chips: [
      { icon: 'branch', label: worktreeLabel(companyKeyOf(data), ticket.id) },
      ...repos.map((r) => ({ icon: 'repo' as const, label: r.name })),
      ...stacks.filter(Boolean).map((label) => ({ icon: 'stack' as const, label })),
    ],
  }
}

/**
 * `Hire · a new Designer named Iris`: what the card and the thread panel both call an Approval.
 * A merge that has no PR is a merge into the local main, which the design titles `Merge locally`.
 */
export function approvalTitle(approval: Approval, data: ChatData): string {
  return `${approvalKind(approval, data)} · ${approval.subject}`
}

function approvalKind(approval: Approval, data: ChatData): string {
  const local =
    approval.action === 'merge' && approval.ticketId !== null && pullRequestsOfApproval(approval, data).length === 0
  return local ? 'Merge locally' : APPROVAL_KIND_LABEL[approval.action]
}

/** The repos a ticket is scoped to, by name, in the Company's order. */
function repoNames(ticketId: number | null, data: ChatData): string[] {
  const ticket = data.board?.tickets.find((t) => t.id === ticketId)
  return (ticket?.repos ?? []).map((id) => data.repos.find((r) => r.id === id)?.name ?? 'removed repo')
}

/** How the boss's decision reads on the card: `Approved by you · 18:02`. */
function decidedFacts(approval: Approval): ApprovalFact[] {
  if (approval.status === 'pending') return []
  const when = approval.decidedAt ? ` · ${formatTime(approval.decidedAt)}` : ''
  return [
    {
      icon: approval.status === 'approved' ? 'approved' : 'rejected',
      label: `${approval.status === 'approved' ? 'Approved' : 'Sent back'} by you${when}`,
    },
    { icon: 'note', label: approval.decisionReason?.trim() || 'No reason given' },
  ]
}

/** What the thread's autonomy row says the current level means for this kind of request. */
export function autonomyNotice(level: AutonomyLevel, action: GatedAction): string {
  if (level === 'autonomous') return 'only red CI and limits ask you'
  if (level === 'supervised') return 'you approve starts, PRs and merges'
  switch (action) {
    case 'merge':
      return 'you approve every merge'
    case 'open_pr':
      return 'you approve every PR'
    case 'hire':
      return 'you approve every hire'
    case 'fire':
      return 'you approve every firing'
    default:
      return 'you approve merges and hires'
  }
}

/** The generic approval card: every kind that does not resolve to a PR (decision 42). */
export function approvalCard(
  approval: Approval,
  message: Message,
  data: ChatData,
): Extract<MessageCard, { kind: 'approval' }> {
  const ticketId = ticketOfApproval(approval)
  const names = repoNames(ticketId, data)
  const ticket = data.board?.tickets.find((t) => t.id === ticketId)
  return {
    kind: 'approval',
    approvalId: approval.id,
    action: approval.action,
    status: approval.status,
    waiting: approval.status === 'pending',
    title: approvalTitle(approval, data),
    reason: approval.reason.trim(),
    facts: [
      // The subject already names the ticket when the engine wrote it; do not say it twice.
      ...(ticket && !approval.subject.startsWith(ticketCode(companyKeyOf(data), ticket.id))
        ? [{ icon: 'ticket' as const, label: `${ticketCode(companyKeyOf(data), ticket.id)} ${ticket.title}` }]
        : []),
      ...(names.length > 0 ? [{ icon: 'repo' as const, label: names.join(', ') }] : []),
      ...decidedFacts(approval),
    ],
    replies: message.replyCount,
    reviewTicketId: reviewTicketOfApproval(approval),
  }
}

/** The thread panel's detail for an approval that is not about a PR: the card, opened up. */
export function approvalDetail(
  approval: Approval,
  data: ChatData,
): { kindLabel: string; title: string; reason: string; waiting: boolean; rows: ApprovalRow[] } {
  const ticketId = ticketOfApproval(approval)
  const ticket = data.board?.tickets.find((t) => t.id === ticketId)
  const names = repoNames(ticketId, data)
  const requester = data.employees.find((e) => e.id === approval.requesterId)
  const rows: ApprovalRow[] = [
    {
      icon: 'who',
      label: `Asked by ${requester?.name ?? 'a former employee'}`,
      meta: requester?.title ?? formatTime(approval.createdAt),
    },
    ...(ticket
      ? [
          {
            icon: 'ticket' as const,
            label: `Ticket · ${ticketCode(companyKeyOf(data), ticket.id)} ${ticket.title}`,
            meta: data.board?.columns.find((c) => c.id === ticket.column)?.title ?? '',
          },
        ]
      : []),
    ...(names.length > 0
      ? [
          {
            icon: 'repo' as const,
            label: `Repos · ${names.join(', ')}`,
            meta: `${names.length} of ${data.repos.length}`,
          },
        ]
      : []),
    ...decidedFacts(approval).map((fact) => ({ ...fact, meta: '' })),
  ]
  return {
    kindLabel: approvalKind(approval, data),
    title: approvalTitle(approval, data),
    reason: approval.reason.trim(),
    waiting: approval.status === 'pending',
    rows,
  }
}

/** How a plan names what it is about: `TC-142 Usage chart`, or the epic's title. */
export function planSubjectLabel(plan: Plan, data: ChatData): string {
  if (plan.ticketId !== null) {
    const ticket = data.board?.tickets.find((t) => t.id === plan.ticketId)
    return [ticketCode(companyKeyOf(data), plan.ticketId), ticket?.title].filter(Boolean).join(' ')
  }
  return data.board?.epics.find((e) => e.id === plan.epicId)?.title ?? 'the epic'
}

/** The Plan card of the frame (`D1E2lt`), and the replan it becomes after approval (`hZrUN`). */
export function planCard(plan: Plan, data: ChatData): Extract<MessageCard, { kind: 'plan' }> {
  const who = (id: string | null) => (id === null ? '' : id === BOSS ? 'you' : nameOf(id, data.employees))
  const repoName = (id: string) => data.repos.find((r) => r.id === id)?.name ?? 'removed repo'
  const decided = plan.approvedAt ? ` · ${formatTime(plan.approvedAt)}` : ''
  const by =
    plan.status === 'approved'
      ? `v${plan.version} · ${plan.approvedBy === BOSS ? 'approved by you' : `self-approved by ${who(plan.approvedBy)}`}${decided}`
      : plan.status === 'replan'
        ? `v${plan.version - 1} → v${plan.version}`
        : `Draft ${plan.version} · by ${who(plan.plannerId) || 'the planner'}`
  const waiting = plan.status === 'waiting' || plan.status === 'replan'
  return {
    kind: 'plan',
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    title: `Plan · ${planSubjectLabel(plan, data)}`,
    by,
    goal: plan.goal,
    approach: plan.approach,
    criteria: plan.acceptanceCriteria,
    repos: plan.repos.map(repoName),
    subtasks: plan.subtasks.map((s) => ({ title: s.title, repo: s.repo === null ? null : repoName(s.repo) })),
    risks: plan.risks,
    openQuestions: plan.openQuestions,
    replan:
      plan.status === 'replan'
        ? { by: who(plan.replanBy), reason: plan.replanReason ?? '', changes: plan.replanChanges }
        : null,
    waiting,
    foot:
      plan.status === 'approved'
        ? `Approved — ${plan.ticketId === null ? 'its tickets inherit it' : 'it is Ready to claim'}`
        : plan.status === 'replan'
          ? 'Back in Planning until you decide'
          : 'Engineers can’t claim it until approved',
    nextStep: planNextStep(plan, who(plan.plannerId) || 'the planner'),
  }
}

/** The numbered questions under the planner's message, answered inline (frame `D1E2lt`). */
export function questionsCard(
  plan: Plan,
  messageId: number,
  data: ChatData,
): Extract<MessageCard, { kind: 'questions' }> {
  const asked = plan.questions.filter((q) => q.messageId === messageId)
  const who = (q: PlanQuestion) =>
    q.answeredBy === null ? null : q.answeredBy === BOSS ? 'you' : nameOf(q.answeredBy, data.employees)
  return {
    kind: 'questions',
    planId: plan.id,
    asker: nameOf(plan.plannerId, data.employees),
    questions: asked.map((q) => ({
      id: q.id,
      number: q.number,
      text: q.text,
      answer: q.answer,
      answeredBy: who(q),
      delegated: q.delegated,
    })),
    waiting: asked.some((q) => q.answer === null),
    // Answered is not approved: without this the card was a column of ticks and nothing else (T233).
    sent: answersSent(plan)
      ? { state: 'Answers sent · waiting for the plan', by: `${nameOf(plan.plannerId, data.employees)} is writing it` }
      : null,
  }
}

/** Whether a plan has anything on the boss's desk right now. */
export function planWaits(plan: Plan): boolean {
  return plan.status === 'waiting' || plan.status === 'replan' || unanswered(plan).length > 0
}

function targetCard(targetId: number, message: Message, data: ChatData): MessageCard {
  const board = data.board!
  const target = board.targets.find((t) => t.id === targetId)!
  const epics = board.epics.filter((e) => e.targetId === targetId)
  const tickets = board.tickets.filter((t) => epics.some((e) => e.id === t.epicId))
  const todo = tickets.filter((t) => t.column === 'todo').length
  const limit = board.columns.find((c) => c.id === 'doing')?.wipLimit ?? null
  return {
    kind: 'target',
    targetId,
    title: target.title,
    due: target.dueAt === null ? null : dueLabel(target.dueAt, new Date(message.createdAt)),
    epics: epics.map((epic) => {
      const own = tickets.filter((t) => t.epicId === epic.id)
      const who = [...new Set(own.map((t) => t.assigneeId).filter((id) => id !== null))]
      return { id: epic.id, title: epic.title, who: who.map((id) => nameOf(id, data.employees)), tickets: own.length }
    }),
    foot: `${plural(todo, 'ticket')} in Todo · ${limit === null ? 'No WIP limit' : `WIP limit ${limit}`} on Doing`,
  }
}

function prCard(
  ticketId: number,
  message: Message,
  data: ChatData,
  waiting: boolean,
  pullRequests = data.code.find((c) => c.ticketId === ticketId)?.pullRequests ?? [],
): MessageCard | null {
  const ticket = data.board?.tickets.find((t) => t.id === ticketId)
  if (pullRequests.length === 0) return null
  return {
    kind: 'pr',
    waiting,
    ticketId,
    pullRequests: pullRequests.map((pr) => ({
      repo: data.repos.find((r) => r.id === pr.repoId)?.name ?? 'removed repo',
      number: pr.number,
      url: pr.url,
      title: ticket?.title ?? ticketCode(companyKeyOf(data), ticketId),
    })),
    reviewer: reviewerLine(ticketId, data),
    replies: message.replyCount,
    handoff: handoffOf(ticketId, data),
    round: roundLine(ticketId, data),
  }
}

/** Where the review stands with the boss, or null once the merge has been decided either way. */
function handoffOf(ticketId: number, data: ChatData): ReviewHandoff | null {
  const review = latestReview(ticketId, data)
  if (!review || review.merge === 'merged' || review.merge === 'rejected') return null
  return review.handoff
}

function latestReview(ticketId: number, data: ChatData): Review | undefined {
  return data.reviews.filter((r) => r.ticketId === ticketId).sort((a, b) => b.id - a.id)[0]
}

/**
 * `Round 2 · 1 open thread`: what the `#prs` card says while the agents review (frame `F2HxCz`).
 * One card per PR that updates in place — never a message per comment.
 */
function roundLine(ticketId: number, data: ChatData): string | null {
  const review = latestReview(ticketId, data)
  if (!review) return null
  const threads = data.threads?.filter((thread) => thread.ticketId === ticketId) ?? []
  const open = openThreadsLabel(threads)
  return [`Round ${review.round}`, open].filter(Boolean).join(' · ')
}

function reviewerLine(ticketId: number, data: ChatData): string | null {
  const latest = data.reviews.filter((r) => r.ticketId === ticketId).sort((a, b) => b.id - a.id)[0]
  if (!latest) return null
  const who = (id: string) => {
    if (id === BOSS) return 'You'
    const found = data.employees.find((e) => e.id === id)
    return found ? `${found.name} · ${found.title}` : 'Former employee'
  }
  if (latest.status === 'pending') {
    return `Waiting for ${latest.reviewerId === BOSS ? 'you' : nameOf(latest.reviewerId, data.employees)}`
  }
  const by = who(latest.decidedBy ?? latest.reviewerId)
  return `${by} ${latest.status === 'approved' ? 'approved' : 'requested changes'}`
}

/** The ticket an approval is about, as the engine recorded it; null when it is not about a ticket. */
export function ticketOfApproval(approval: Approval): number | null {
  return approval.ticketId
}

/** The PRs an approval is about: the one it names, else all of its ticket's. */
export function pullRequestsOfApproval(approval: Approval, data: ChatData): PullRequest[] {
  const ticketId = ticketOfApproval(approval)
  const all = data.code.find((c) => c.ticketId === ticketId)?.pullRequests ?? []
  const named = approval.pullRequest
  return named ? all.filter((pr) => pr.repoId === named.repoId && pr.number === named.number) : all
}

/** `+142 −38` over all of a ticket's PRs. */
export function diffLabel(details: PullRequestDetails[]): string {
  const add = details.reduce((sum, d) => sum + d.additions, 0)
  const del = details.reduce((sum, d) => sum + d.deletions, 0)
  return `+${add} −${del}`
}

export function checksSummary(details: PullRequestDetails[]): {
  state: 'passing' | 'failing' | 'pending' | 'none'
  label: string
} {
  const checks = details.flatMap((d) => d.checks).filter((c) => c.state !== 'skipped')
  if (checks.length === 0) return { state: 'none', label: 'No checks' }
  const failing = checks.filter((c) => c.state === 'failing').length
  if (failing > 0) return { state: 'failing', label: `${failing}/${checks.length} checks failing` }
  const passing = checks.filter((c) => c.state === 'passing').length
  return {
    state: passing === checks.length ? 'passing' : 'pending',
    label: `${passing}/${checks.length} checks green`,
  }
}

/** `6s`, `1m 04s`, `1h 02m`; empty when unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`
}

export function mergeBadge(details: PullRequestDetails): {
  variant: 'success' | 'danger' | 'neutral' | 'primary'
  label: string
} {
  if (details.state === 'merged') return { variant: 'primary', label: 'Merged' }
  if (details.state === 'closed') return { variant: 'neutral', label: 'Closed' }
  if (details.checks.some((c) => c.state === 'failing')) return { variant: 'danger', label: 'Checks failing' }
  if (details.mergeable === 'conflicting') return { variant: 'danger', label: 'Conflicts' }
  if (details.mergeable === 'unknown') return { variant: 'neutral', label: 'Checking' }
  return { variant: 'success', label: 'Mergeable' }
}

export function threadTitle(
  root: Message,
  approval: Approval | undefined,
  data: ChatData,
): { title: string; origin: string } {
  const dm = dmMembers(root.channelId)
  const where = dm
    ? dm
        .filter((m) => m !== BOSS)
        .map((id) => nameOf(id, data.employees))
        .join(' ↔ ')
    : `#${root.channelId}`
  const by =
    root.authorId === BOSS
      ? 'you'
      : root.authorId === COMPANY_AUTHOR
        ? 'tinycorp'
        : (data.employees.find((e) => e.id === root.authorId)?.name ?? 'a former employee')
  return { title: approval ? 'Approval thread' : 'Thread', origin: `${where} · opened by ${by}` }
}
