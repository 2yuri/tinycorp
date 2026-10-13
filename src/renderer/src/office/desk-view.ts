// What the boss's desk panel shows, derived from engine data (Pen frame `KP0yY`). Pure, so the
// rules are tested without a DOM: the panel itself only draws what this returns.
import type { Approval } from '../../../shared/approvals'
import type { Message } from '../../../shared/domain/chat'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { approvalCard, type ChatData, formatTime, type MessageCard, nameOf, roleTag } from '../chat'

/** One card of `Waiting on you`: who asked, when, and the chat's own approval card for it. */
export interface DeskApproval {
  approval: Approval
  /** The requester's display name and the tag after it (`DEVOPS`, `PM · INTAKE`). */
  who: string
  role: string
  /** `09:31`, as the frame writes it. */
  time: string
  card: Extract<MessageCard, { kind: 'approval' }>
}

export interface DeskView {
  /** The head's second line: `3 waiting on you · 2 unread`. */
  summary: string
  /** Every Approval the boss still owes a decision, oldest first. */
  waiting: DeskApproval[]
  /** What is unread and is not already a card above, newest first. */
  unread: BossInboxItem[]
  /** True when neither section has anything: the panel shows `Nothing is waiting on you`. */
  empty: boolean
}

/**
 * The desk over the Approvals the boss owns and their Inbox. An Approval that is also an unread
 * Inbox row is a card, not a row: the boss should be asked for the decision once.
 */
export function deskView(approvals: Approval[], inbox: BossInboxItem[], data: ChatData): DeskView {
  const pending = approvals.filter((a) => a.status === 'pending').sort(byOldest)
  const carded = new Set(pending.map((a) => a.id))
  const unread = inbox
    .filter((item) => item.unread && !(item.approvalId !== null && carded.has(item.approvalId)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.messageId - a.messageId)
  const waiting = pending.map((approval) => toCard(approval, data))
  return {
    summary: `${waiting.length} waiting on you · ${unread.length} unread`,
    waiting,
    unread,
    empty: waiting.length === 0 && unread.length === 0,
  }
}

/** The frame lists them in the order they arrived: the boss works the queue from its head. */
function byOldest(a: Approval, b: Approval): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id
}

function toCard(approval: Approval, data: ChatData): DeskApproval {
  // The card only reads the message's reply count, which the desk draws no affordance for.
  const message = { id: approval.messageId, replyCount: 0 } as Message
  return {
    approval,
    who: nameOf(approval.requesterId, data.employees),
    role: roleTag(approval.requesterId, data.employees),
    time: formatTime(approval.createdAt),
    card: approvalCard(approval, message, data),
  }
}
