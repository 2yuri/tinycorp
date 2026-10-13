import type { DatabaseSync } from 'node:sqlite'
import { type ColleagueVoice, DEFAULT_COLLEAGUE_VOICE, voiceHint } from '../../../shared/colleague-voice'
import { BOSS, COMPANY_AUTHOR, dmMembers, type Message } from '../../../shared/domain/chat'

/**
 * How many replies before the newest one a `thread` prompt quotes, besides the root. A wake pays
 * for every one of them, so it is the root and the last few, never the whole thread: what came
 * before that is a `chat_read` away (T180).
 */
export const THREAD_CONTEXT_REPLIES = 3

/** Per Company database: the Employee a reply being posted in each thread must not wake as `thread`. */
const quieted = new WeakMap<DatabaseSync, Map<number, string>>()

/**
 * Runs `post` (which replies in `threadId`) without a `thread` wake for `employeeId`, because the
 * caller files that Employee a more specific item about the reply, like an approval decision.
 */
export function withoutThreadWake<T>(db: DatabaseSync, threadId: number, employeeId: string, post: () => T): T {
  const byThread = quieted.get(db) ?? new Map<number, string>()
  quieted.set(db, byThread)
  byThread.set(threadId, employeeId)
  try {
    return post()
  } finally {
    byThread.delete(threadId)
  }
}

/**
 * Who a thread reply answers (decision 41): the author of the latest earlier message in the thread,
 * root included, by someone other than the replier and the Company. `BOSS` when that is the boss,
 * null for a top-level message and when the replier is the only one who spoke.
 *
 * The boss answers whoever last spoke *to them* (T270): the latest of those messages that names
 * the boss or names nobody. In a thread two Employees are also talking in, the last message is
 * often one of them answering the other, `@Designer switched it to 380px`, and a boss writing
 * `love it, move the notification up` is not answering that — sent there, it went to the wrong
 * Employee, who was busy, and the one the boss was talking to never heard it.
 */
export function repliedTo(db: DatabaseSync, message: Message): string | null {
  if (message.threadId === null) return null
  const earlier = [message.threadId, message.threadId, message.id, message.authorId, COMPANY_AUTHOR] as const
  if (message.authorId === BOSS) {
    const toBoss = db
      .prepare(
        `SELECT author_id AS authorId FROM message WHERE (id = ? OR thread_id = ?) AND id < ?
         AND author_id NOT IN (?, ?)
         AND (mentions = '[]' OR EXISTS (SELECT 1 FROM json_each(message.mentions) WHERE value = ?))
         ORDER BY id DESC LIMIT 1`,
      )
      .get(...earlier, BOSS) as { authorId: string } | undefined
    if (toBoss) return toBoss.authorId
  }
  const row = db
    .prepare(
      `SELECT author_id AS authorId FROM message WHERE (id = ? OR thread_id = ?) AND id < ?
       AND author_id NOT IN (?, ?) ORDER BY id DESC LIMIT 1`,
    )
    .get(...earlier) as { authorId: string } | undefined
  return row?.authorId ?? null
}

/** The Employee whose `thread` wake is held back while a reply is posted in `threadId`. */
export function quietedIn(db: DatabaseSync, threadId: number | null): string | null {
  return threadId === null ? null : (quieted.get(db)?.get(threadId) ?? null)
}

/** One message quoted in a `thread` prompt. */
export interface ThreadLine {
  id: number
  authorId: string
  text: string
}

/**
 * What a `thread` item for `employeeId` tells it: the root, the replies before the new ones for
 * context, then the new ones (folded while it was busy, oldest first).
 */
export function threadContext(
  db: DatabaseSync,
  threadId: number,
  newIds: number[],
): { root: ThreadLine | undefined; earlier: ThreadLine[]; fresh: ThreadLine[] } {
  const root = db.prepare('SELECT id, author_id AS authorId, text FROM message WHERE id = ?').get(threadId) as
    | ThreadLine
    | undefined
  const first = Math.min(...newIds)
  const earlier = (
    db
      .prepare(
        `SELECT id, author_id AS authorId, text FROM message WHERE thread_id = ? AND id < ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(threadId, first, THREAD_CONTEXT_REPLIES) as unknown as ThreadLine[]
  ).reverse()
  const wanted = new Set(newIds)
  const fresh = (
    db
      .prepare('SELECT id, author_id AS authorId, text FROM message WHERE thread_id = ? AND id >= ? ORDER BY id')
      .all(threadId, first) as unknown as ThreadLine[]
  ).filter((m) => wanted.has(m.id))
  return { root, earlier, fresh }
}

/**
 * `[company] thread reply from <who> in <where>`, the thread's root, its recent replies and the
 * new ones, then to answer with `thread_reply`. Texts are JSON-quoted so the prompt stays on one line.
 */
export function threadPrompt(
  channelId: string,
  threadId: number,
  context: ReturnType<typeof threadContext>,
  nameOf: (id: string) => string,
  takingOverFrom: string | null = null,
  voice: ColleagueVoice = DEFAULT_COLLEAGUE_VOICE,
): string {
  const { root, earlier, fresh } = context
  const quote = (m: ThreadLine) => `from ${nameOf(m.authorId)} (message ${m.id}): ${JSON.stringify(m.text)}`
  const channel = dmMembers(channelId) ? 'a DM' : `#${channelId}`
  const count = fresh.length === 1 ? 'a reply' : `${fresh.length} replies`
  const from = [...new Set(fresh.map((m) => nameOf(m.authorId)))].join(', ')
  const parts = [
    takingOverFrom
      ? `[company] thread in ${channel}, thread ${threadId}: you are taking over from ${takingOverFrom}, ` +
        'who left; you answer the boss here now.'
      : `[company] thread reply from ${from} in ${channel}, thread ${threadId}, a reply for you:`,
    root ? `root ${quote(root)}.` : '',
    earlier.length ? `Earlier replies: ${earlier.map(quote).join('; ')}.` : '',
    fresh.length ? `New, ${count}, oldest first: ${fresh.map((m, i) => `${i + 1}. ${quote(m)}`).join(' ')}` : '',
    voiceHint(channelId, voice),
    `Answer in the thread through the company MCP server: thread_reply to message ${threadId}; ` +
      'no answer is needed if nothing is asked of you. Never answer in plain text.',
  ]
  return parts.filter(Boolean).join(' ')
}
