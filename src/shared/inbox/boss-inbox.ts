import type { SessionAsk } from '../session'

/**
 * Why a row is in the boss's Inbox (decision 43), most specific first: `asking` a Session stopped
 * in its terminal waiting for the boss to answer it (T165), `approval` a decision the boss owns,
 * `plan` a drafted plan waiting for Approve or Ask for changes (T233), `waiting` the engine's
 * notice that a boss message has nobody free to answer it (decision 41), `dm` a direct message to
 * the boss, `mention` an `@boss`, `thread` a reply in a thread the boss started or posted in. One
 * message takes the first kind that fits.
 *
 * Every kind but `asking` is a message. `asking` is live engine state: the row exists while the
 * Session is asking and resolves itself the moment the ask clears, so nothing is ever written to
 * chat about a question that was answered in a terminal.
 */
export const BOSS_INBOX_KINDS = ['asking', 'approval', 'plan', 'waiting', 'dm', 'mention', 'thread'] as const
export type BossInboxKind = (typeof BOSS_INBOX_KINDS)[number]

/** One row of the boss's Inbox: something addressed to the boss, and where it can be opened. */
export interface BossInboxItem {
  /**
   * The row's identity, unique in the Inbox: `m<message id>` for a message, `ask:<employee id>`
   * for a Session that is asking.
   */
  id: string
  /** The message the row is about, or 0 for a row that is no message. */
  messageId: number
  kind: BossInboxKind
  channelId: string
  /** The thread to open the panel on: the message's thread root, or the message itself. */
  threadId: number
  /** `BOSS`, an Employee id, or `COMPANY_AUTHOR`. */
  fromId: string
  text: string
  createdAt: string
  /** False once the boss has read the row's channel. */
  unread: boolean
  /** The Approval the row is about, for `approval` rows; null otherwise. */
  approvalId: number | null
  /**
   * The plan the row is about, for `plan` rows; null otherwise. A drafted plan is a decision the
   * boss owns, so it reaches the Inbox with its own Approve / Ask for changes (T233).
   */
  planId: number | null
  /** The test attempt the message is about (T174); null on every other row. */
  testRunId: number | null
}

/** The row id a message takes; the ids are one namespace, so a message and an ask cannot collide. */
export function messageRowId(messageId: number): string {
  return `m${messageId}`
}

/** The row id the Session of `employeeId` takes while it is asking. One row per Employee at a time. */
export function askRowId(employeeId: string): string {
  return `ask:${employeeId}`
}

/** `Nova is asking in their terminal: Write src/api/usage.ts` — what the row and the banner say. */
export function askingText(name: string, ask: Pick<SessionAsk, 'what'>): string {
  return `${name} is asking in their terminal: ${ask.what}`
}

/**
 * The Inbox rows for the Sessions that are stopped asking the boss (T165), newest ask first.
 *
 * They are derived, never stored: a row lives exactly as long as the ask behind it, so answering
 * in the terminal is what resolves it and nothing has to be marked read. `fromId` is the Employee,
 * which is both the avatar the row draws and the drawer its action opens.
 */
export function askingInboxItems(
  asks: readonly { employeeId: string; ask: SessionAsk }[],
  nameOf: (employeeId: string) => string,
): BossInboxItem[] {
  return [...asks]
    .sort((a, b) => Date.parse(b.ask.since) - Date.parse(a.ask.since) || a.employeeId.localeCompare(b.employeeId))
    .map(({ employeeId, ask }) => ({
      id: askRowId(employeeId),
      messageId: 0,
      kind: 'asking' as const,
      channelId: '',
      threadId: 0,
      fromId: employeeId,
      text: askingText(nameOf(employeeId), ask),
      createdAt: ask.since,
      // It is unread until it is gone: the only thing that clears it is the boss answering.
      unread: true,
      approvalId: null,
      planId: null,
      testRunId: null,
    }))
}

/**
 * How the engine opens the notice that a boss message is waiting for an answerer with capacity
 * (decision 41). The Inbox recognises it by this opening, so the notice needs no table of its own.
 */
export const CAPACITY_NOTICE = 'Waiting for capacity:'

/**
 * What the Inbox counts as waiting on the boss: its rows the boss has not read. The sidebar's Inbox
 * row and the Company rail's badge both count with this, so the two can never disagree (T145).
 */
export function bossInboxUnread(items: Pick<BossInboxItem, 'unread'>[]): number {
  return items.filter((item) => item.unread).length
}

/**
 * The same rows, cut by the conversation each one is in (T251): what the red pill on a channel or
 * DM line says. One derivation for every line in the sidebar, so a line and the Inbox row above it
 * can never be counting different things.
 *
 * An `asking` row is in no channel — the boss answers it in a terminal — so it is in none of these
 * totals, and the sum of the lines is the Inbox's count less however many Sessions are asking.
 */
export function bossInboxUnreadByChannel(items: Pick<BossInboxItem, 'unread' | 'channelId'>[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    if (!item.unread || item.channelId === '') continue
    counts[item.channelId] = (counts[item.channelId] ?? 0) + 1
  }
  return counts
}
