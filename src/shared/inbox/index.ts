/**
 * Why an Employee was woken: `dm` a direct message, `mention` an `@Name`, `channel` an `@channel`,
 * `ticket` a `#<id>` of a ticket it holds, `epic` a message in an epic channel it belongs to,
 * `approval` the boss's decision on an Approval the Employee requested, `assigned` a ticket
 * assigned to it, `intake` a boss message that addresses nobody, routed to its answerer (decision 41),
 * `resume` what a fresh Session needs to catch up when its previous one could not be resumed,
 * `review` a ticket's PRs to review, or a reviewer's changes requested on a ticket it holds,
 * `general` a top-level channel message someone else answers, filed unread,
 * `thread` a reply to its message in a thread, or to the boss in a thread it answers, folded per thread while it waits,
 * `session` a Session it started of its own (T163) finished, with what it reported,
 * `planning` something it has to plan: a new ticket or epic, the boss's answers, or a replan (T171),
 * `testing` a ticket in Testing for it to test, or its own ticket that failed a test (T174),
 * `unblocked` a ticket it holds whose last blocker is Done, so it no longer waits (T266).
 * `deleted` a ticket it held that the boss deleted, so it drops it (T275).
 * One message wakes each Employee at most once, with the most specific kind: the order above,
 * with `thread` right after `epic`.
 */
export const WAKE_KINDS = [
  'dm',
  'mention',
  'ticket',
  'channel',
  'epic',
  'approval',
  'assigned',
  'intake',
  'resume',
  'review',
  'general',
  'thread',
  'session',
  'planning',
  'testing',
  'unblocked',
  'deleted',
] as const
export type WakeKind = (typeof WAKE_KINDS)[number]

/**
 * `pending` waits for the Employee to be idle; `handled` was pushed and accepted as a prompt;
 * `unread` is there to read and is never pushed (decision 41).
 */
export type InboxStatus = 'pending' | 'handled' | 'unread'

/** Something waiting for, or already delivered to, one Employee. */
export interface InboxItem {
  id: number
  employeeId: string
  kind: WakeKind
  /** `BOSS` or an Employee id. */
  fromId: string
  /** Where the message was posted; null for an item that is not a message, like an assignment. */
  channelId: string | null
  /** The thread the message is in, or null for a top-level message. */
  threadId: number | null
  messageId: number | null
  /** The ticket assigned or referenced, for `assigned` and `ticket` items. */
  ticketId: number | null
  text: string
  /** Exactly what is typed into the Employee's Session. */
  prompt: string
  status: InboxStatus
  /** How many times the prompt was pushed. */
  attempts: number
  createdAt: string
  handledAt: string | null
}
