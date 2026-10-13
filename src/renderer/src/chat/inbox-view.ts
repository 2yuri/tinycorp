// What the Chat Inbox shows, derived from engine data. Pure, so the rules are tested without a DOM.
import type { Approval } from '../../../shared/approvals'
import { approvalQuestion } from '../../../shared/approvals/approval-summary'
import { dmMembers } from '../../../shared/domain/chat'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import type { Plan } from '../../../shared/planning/planning'
import type { TestRun } from '../../../shared/testing'
import { parseTicketRefs } from '../../../shared/ticket-refs'
import { type ChannelHeader, type ChatData, companyKeyOf, formatTime, nameOf } from './chat-view'

/** Where the code flow announces PRs and review rounds; the engine posts them there. */
const PRS_CHANNEL = 'prs'

/** The filter chips above the list, in their fixed order. */
export const INBOX_FILTERS = ['all', 'mentions', 'threads', 'approvals', 'dms'] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

export const FILTER_LABEL: Record<InboxFilter, string> = {
  all: 'All',
  mentions: 'Mentions',
  threads: 'Threads',
  approvals: 'Approvals',
  dms: 'DMs',
}

/** Which rows a chip keeps. `All` keeps everything, the capacity notices included. */
export function matchesFilter(item: BossInboxItem, filter: InboxFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'mentions':
      return item.kind === 'mention'
    case 'threads':
      return item.kind === 'thread'
    // A drafted plan is a decision the boss owns, so the Approvals chip keeps it too (T233).
    case 'approvals':
      return item.kind === 'approval' || item.kind === 'plan'
    case 'dms':
      return item.kind === 'dm'
  }
}

/** How many rows each chip would show. */
export function filterCounts(items: BossInboxItem[]): Record<InboxFilter, number> {
  const counts = Object.fromEntries(INBOX_FILTERS.map((f) => [f, 0])) as Record<InboxFilter, number>
  for (const item of items) for (const filter of INBOX_FILTERS) if (matchesFilter(item, filter)) counts[filter]++
  return counts
}

/** The Inbox's content header, in place of a channel's. */
export function inboxHeader(items: BossInboxItem[]): ChannelHeader {
  const unread = unreadCount(items)
  return {
    title: 'Inbox',
    members: `${unread} unread`,
    memberIds: [],
    topic: 'Everything waiting on you, newest first. Click a row to open its thread.',
  }
}

export function unreadCount(items: BossInboxItem[]): number {
  return items.filter((item) => item.unread).length
}

/** The channel and thread a row opens. */
export function rowTarget(item: BossInboxItem): { channelId: string; threadId: number } {
  return { channelId: item.channelId, threadId: item.threadId }
}

/**
 * The Employee whose drawer terminal a row opens instead of a thread, or null. Only an `asking`
 * row has one: the boss answers that question in the terminal, so that is where the row goes (T165).
 */
export function rowTerminal(item: BossInboxItem): string | null {
  return item.kind === 'asking' ? item.fromId : null
}

/** The icon beside a row's kind label; the component maps it to a Lucide icon. */
export type InboxIcon = 'approval' | 'plan' | 'asking' | 'waiting' | 'dm' | 'mention' | 'thread' | 'decided'

export interface InboxRow {
  item: BossInboxItem
  /** The row's key, unique across messages and the live rows that are none. */
  id: string
  /** The message the row is about, or 0 for a row that is no message. */
  messageId: number
  /** Who the row is from: their display name and the id their avatar draws. */
  who: string
  fromId: string
  kindLabel: string
  icon: InboxIcon
  /** `#tech`, or `DM` for a direct message. */
  where: string
  excerpt: string
  /** `09:31` today, `Yesterday`, else a short date. */
  time: string
  unread: boolean
  /** The pending Approval whose Approve / Send back actions the row carries. */
  approval: Approval | null
  /** The drafted plan whose Approve / Ask for changes the row carries (T233). */
  plan: Plan | null
  /** The ticket whose Review screen the row opens, for a `#prs` row about a ticket in review (T75). */
  reviewTicketId: number | null
  /** The test attempt waiting on the boss, whose `Run it` the row carries (T174). */
  test: TestRun | null
}

export interface InboxGroup {
  label: 'Today' | 'Earlier'
  rows: InboxRow[]
}

/**
 * The rows the filter keeps, grouped Today then Earlier, and inside each group unread first, then a
 * decision the boss owes, then newest first — so what needs the boss sits at the top of its day.
 */
export function inboxGroups(
  items: BossInboxItem[],
  data: ChatData,
  filter: InboxFilter = 'all',
  now: Date = new Date(),
): InboxGroup[] {
  const kept = items.filter((item) => matchesFilter(item, filter))
  const groups: InboxGroup[] = [
    { label: 'Today', rows: [] },
    { label: 'Earlier', rows: [] },
  ]
  for (const item of kept) {
    const today = isSameDay(new Date(item.createdAt), now)
    groups[today ? 0 : 1]!.rows.push(toRow(item, data, now))
  }
  for (const group of groups) {
    group.rows.sort(
      (a, b) =>
        Number(b.unread) - Number(a.unread) ||
        Number(decides(b)) - Number(decides(a)) ||
        Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt) ||
        b.messageId - a.messageId ||
        a.id.localeCompare(b.id),
    )
  }
  return groups.filter((group) => group.rows.length > 0)
}

/** Whether a row is a decision the boss owes, which sorts it above the rest of its day. */
function decides(row: InboxRow): boolean {
  return row.approval !== null || row.plan !== null
}

const KIND_LABEL: Record<BossInboxItem['kind'], string> = {
  asking: 'Asking you',
  approval: 'Approval',
  plan: 'Plan to approve',
  waiting: 'Waiting',
  dm: 'Direct message',
  mention: 'Mention',
  thread: 'Thread reply',
}

function toRow(item: BossInboxItem, data: ChatData, now: Date): InboxRow {
  const approval = item.kind === 'asking' ? null : (data.approvals.get(item.messageId) ?? null)
  const pending = approval?.status === 'pending' ? approval : null
  const plan = planOf(item, data)
  const who = nameOf(item.fromId, data.employees)
  const decided = approval && approval.status !== 'pending'
  return {
    item,
    id: item.id,
    messageId: item.messageId,
    who,
    fromId: item.fromId,
    kindLabel: decided ? (approval.status === 'approved' ? 'Approved' : 'Sent back') : KIND_LABEL[item.kind],
    icon: decided ? 'decided' : item.kind,
    // An ask lives in a terminal, not a channel: the row says where it really is.
    where: item.kind === 'asking' ? 'terminal' : dmMembers(item.channelId) ? 'DM' : `#${item.channelId}`,
    excerpt: excerptOf(item, approval, plan),
    time: inboxTime(item.createdAt, now),
    unread: item.unread,
    approval: pending,
    plan,
    reviewTicketId: reviewTicketOf(item, data),
    test: testOf(item, data),
  }
}

/** The plan a row waits on, for a `plan` row whose plan the renderer has read; null otherwise. */
export function planOf(item: BossInboxItem, data: ChatData): Plan | null {
  if (item.planId === null) return null
  return (data.plans ?? []).find((one) => one.id === item.planId) ?? null
}

/**
 * The test attempt a row is about (T174, frame `YatUW` card d), when the ticket is still waiting on
 * the boss: the row then carries `Run it` and a way into the evidence, as the board card does.
 */
export function testOf(item: BossInboxItem, data: ChatData): TestRun | null {
  if (item.testRunId === null) return null
  const run = (data.tests ?? []).find((entry) => entry.id === item.testRunId)
  return run && run.state === 'you' ? run : null
}

/**
 * The ticket a `#prs` row is about, when the board still has it in Review: the row then carries a
 * way straight into the Review screen, as the ticket and the board card do.
 *
 * Never on a row that is itself asking whether to open the PR: that row's question is `Open the PR
 * for TC-3?`, and a Review button on it read as a pull request to review before one existed (T233).
 */
export function reviewTicketOf(item: BossInboxItem, data: ChatData): number | null {
  if (item.kind === 'asking' || item.channelId !== PRS_CHANNEL) return null
  const approval = data.approvals.get(item.messageId)
  if (approval?.status === 'pending' && approval.action === 'open_pr') return null
  const [id] = parseTicketRefs(item.text, companyKeyOf(data))
  if (id === undefined) return null
  const ticket = data.board?.tickets.find((t) => t.id === id)
  return ticket?.column === 'review' ? ticket.id : null
}

/**
 * One line: an Approval reads as the sentence its requester wrote (decision 42), a plan as what it
 * is waiting for, anything else as its text.
 */
function excerptOf(item: BossInboxItem, approval: Approval | null, plan: Plan | null): string {
  if (item.kind === 'asking') return item.text.replace(/\s+/g, ' ').trim()
  if (plan) return planExcerpt(plan)
  const text = approval ? approval.reason.trim() || approvalQuestion(approval.action, approval.subject) : item.text
  return text.replace(/\s+/g, ' ').trim()
}

/** `Plan v1 ready: approve it and TC-142 goes to Ready`, or what a replan asks for. */
function planExcerpt(plan: Plan): string {
  if (plan.status === 'replan') {
    return `Replan v${plan.version} requested: ${plan.replanReason?.replace(/\s+/g, ' ').trim() || 'approve it or keep the plan you have'}`
  }
  return `Plan v${plan.version} is ready: approve it, or send it back`
}

/** `09:31` for today, `Yesterday`, then `Mar 4`. */
export function inboxTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (isSameDay(date, now)) return formatTime(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
