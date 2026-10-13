import type { Message, MessageKind } from '../../../shared/domain/chat'

/** A row of `message`, with the reply count the chat's queries select alongside it. */
export interface MessageRow {
  id: number
  /** `post` for everything a person says; `digest` for the daily digest the app writes (T172). */
  kind: MessageKind
  channel_id: string
  thread_id: number | null
  author_id: string
  text: string
  mentions: string
  mentions_channel: number
  created_at: string
  reply_count: number
  target_id: number | null
  /** The test attempt the message is about (T174), or null. Absent on rows read before it existed. */
  test_run_id?: number | null
}

/** The reply count of a top-level message, as a correlated subquery over the alias `m`. */
export const REPLY_COUNT = '(SELECT COUNT(*) FROM message r WHERE r.thread_id = m.id) AS reply_count'

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    kind: row.kind,
    channelId: row.channel_id,
    threadId: row.thread_id,
    authorId: row.author_id,
    text: row.text,
    mentions: JSON.parse(row.mentions) as string[],
    mentionsChannel: row.mentions_channel === 1,
    replyCount: row.thread_id === null ? row.reply_count : 0,
    createdAt: row.created_at,
    ...(row.target_id !== null && { targetId: row.target_id }),
    ...(row.test_run_id != null && { testRunId: row.test_run_id }),
  }
}
