import type { Attachment, AttachmentSource } from '../attachments'
import type { DailyDigest } from '../planning/daily-digest'

/** The participant id of the boss (the app's user). Employees are identified by their Employee id. */
export const BOSS = 'boss'

/** The author id of messages the Company itself posts, e.g. that the budget is exhausted. */
export const COMPANY_AUTHOR = 'company'

/** The channels every Company starts with. `prs` is where code-flow events land. */
export const DEFAULT_CHANNELS = ['general', 'tech', 'prs'] as const

/** What `@channel` in a message means: everyone in the conversation. */
export const CHANNEL_MENTION = 'channel'

export interface Channel {
  /** A named channel's id is its name (`tech`); a DM's id comes from `dmChannelId`. */
  id: string
  kind: 'channel' | 'dm'
  /** `tech` for a channel; for a DM, empty (show the other participant's name). */
  name: string
  /** For a DM, its two participant ids. For a named channel, empty means everyone (T44). */
  members: string[]
  /** The boss's one-line topic, shown in the header subtitle; empty until one is written (T44). */
  topic: string
}

/**
 * What a message is. `post` is everything a person says; `digest` is the daily digest the app
 * writes for itself (T172), which is drawn as a card, wakes nobody and enters no Employee's inbox.
 */
export type MessageKind = 'post' | 'digest'

export interface Message {
  id: number
  kind: MessageKind
  channelId: string
  /** The root message of the thread this is a reply in, or null for a top-level message. */
  threadId: number | null
  /** `BOSS` or an Employee id. */
  authorId: string
  text: string
  /** Participants `@`-mentioned in the text: Employee ids, and `BOSS` for `@boss`. */
  mentions: string[]
  /** True when the text says `@channel`. */
  mentionsChannel: boolean
  /** Replies in this message's thread; always 0 for a reply. */
  replyCount: number
  createdAt: string
  /** The files attached to it (decision 37); absent when it carries none. */
  attachments?: Attachment[]
  /** The Target it announces, drawn as the target card under it (T151); absent when it names none. */
  targetId?: number
  /**
   * The test attempt it is about (T174), drawn as the evidence card under it — the QA agent's pass,
   * a failed step's bug thread, or the Company asking the boss to test. Absent on every other message.
   */
  testRunId?: number
  /** The day it sums up, on a `digest` message; absent on every other kind. */
  digest?: DailyDigest
}

export interface NewMessage {
  authorId: string
  channelId: string
  text: string
  /**
   * Participants to carry as mentions besides those the text names, e.g. the boss on an approval
   * request, whose message is one plain sentence (decision 42).
   */
  mentions?: string[]
  /** Files to attach. One of them over the limit refuses the whole post: nothing is written. */
  attachments?: AttachmentSource[]
  /** The Target the message announces; one that does not exist refuses the post. */
  targetId?: number
  /** The test attempt the message is about; one that does not exist refuses the post. */
  testRunId?: number
}

export interface NewReply {
  authorId: string
  /** Any message of the thread; replies always attach to its root. */
  messageId: number
  text: string
  /** Files to attach, as on a post. */
  attachments?: AttachmentSource[]
}

export interface ChatQuery {
  channelId: string
  /** With a thread id: the root and its replies. Without: the channel's top-level messages. */
  threadId?: number
  /** The newest `limit` messages, oldest first. */
  limit?: number
}

/**
 * What the boss has and has not read, by channel id: one answer, because the two are read from the
 * same `chat_read_mark` in the same breath and a screen that had one without the other would be
 * asking the engine the same question twice (T251).
 */
export interface BossUnread {
  /** Unread messages (replies included) by channel id; a channel with none is left out. */
  counts: Record<string, number>
  /**
   * The newest message id the boss has read, by channel id; a channel they have never opened is
   * left out. The Inbox's New divider is placed from this, at the value it had before the row was
   * opened — opening one marks its channel read.
   */
  readMarks: Record<string, number>
}

/** The DM between two participants. The same pair always yields the same id, in any order. */
export function dmChannelId(a: string, b: string): string {
  return `dm:${[a, b].sort().join(':')}`
}

export function dmMembers(channelId: string): string[] | null {
  if (!channelId.startsWith('dm:')) return null
  const members = channelId.slice(3).split(':')
  return members.length === 2 && members.every(Boolean) ? members : null
}

export interface Mentionable {
  id: string
  name: string
}

/**
 * Finds `@Name` mentions in `text`. Names match case-insensitively and may contain spaces;
 * the longest name wins, and a name must not run on into more letters or digits.
 */
export function parseMentions(text: string, people: Mentionable[]): { mentions: string[]; mentionsChannel: boolean } {
  const candidates = [...people, { id: BOSS, name: BOSS }, { id: CHANNEL_MENTION, name: CHANNEL_MENTION }]
    .filter((p) => p.name)
    .sort((a, b) => b.name.length - a.name.length)
  const found = new Set<string>()
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && /[\p{L}\p{N}_.]/u.test(text[at - 1]!)) continue
    const rest = text.slice(at + 1).toLowerCase()
    const hit = candidates.find(
      (p) => rest.startsWith(p.name.toLowerCase()) && !/^[\p{L}\p{N}_]/u.test(rest.slice(p.name.length)),
    )
    if (hit) found.add(hit.id)
  }
  const mentionsChannel = found.delete(CHANNEL_MENTION)
  return { mentions: [...found], mentionsChannel }
}

/** The `@…` being typed just before `caret`, or null when the caret is not in a mention. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|[^\p{L}\p{N}_.])@([\p{L}\p{N}_.-]*)$/u.exec(before)
  if (!match) return null
  return { start: before.length - match[2]!.length - 1, query: match[2]! }
}

/** Who `@query` could mean: Employees whose name starts with it, then `@channel`. */
export function mentionSuggestions(query: string, people: Mentionable[]): Mentionable[] {
  const q = query.toLowerCase()
  return [...people, { id: CHANNEL_MENTION, name: CHANNEL_MENTION }].filter((p) => p.name.toLowerCase().startsWith(q))
}

/** `text` with the mention at `start…caret` replaced by `@name `, and where the caret goes next. */
export function completeMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length }
}

/** A channel post as an Employee wrote it, before the engine decides whether the boss is named. */
export interface AddressedPost {
  channelId: string
  text: string
  /** True when the Employee said the message is for the boss (`chat_post`'s `to`). */
  toBoss: boolean
}

/**
 * The text a channel post really carries, with `@boss` written into it when the post is addressed
 * to the boss and does not name them yet (TI-5).
 *
 * A message the boss is never told about was not said to them: the banner and the Inbox row both
 * follow the `@boss` mention, so an Employee that addresses the boss in a channel without one is
 * talking to a wall. The engine writes the mention rather than trusting every Employee to remember
 * it, and it writes it into the text rather than carrying it beside the message, because a channel
 * is read by a person and the mention is what makes a message look addressed to them.
 *
 * Two places it stays out of. A DM to the boss notifies them on its own, so the mention would only
 * be noise; and a thread reply never comes through here, because a thread the boss is in notifies
 * them without one (TI-4).
 */
export function textAddressedToBoss(post: AddressedPost, people: Mentionable[]): string {
  const text = post.text.trim()
  if (!post.toBoss || dmMembers(post.channelId)) return text
  const { mentions } = parseMentions(text, people)
  return mentions.includes(BOSS) ? text : `@${BOSS} ${text}`.trim()
}
