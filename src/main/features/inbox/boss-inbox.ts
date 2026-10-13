import type { DatabaseSync } from 'node:sqlite'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type BossInboxItem, type BossInboxKind, CAPACITY_NOTICE, messageRowId } from '../../../shared/inbox/boss-inbox'

/**
 * The newest rows the Inbox query answers with; older messages fall off the bottom, except a
 * pending Approval, which waits on the boss however old it is.
 */
const INBOX_LIMIT = 50

/** Everything addressed to the boss, across channels, threads, DMs and Approvals (decision 43). */
export interface BossInbox {
  /**
   * The boss's Inbox rows, newest first. A message appears once, under the most specific kind
   * that fits it; the boss's own messages and channel chatter that names nobody stay out.
   */
  bossInbox(): BossInboxItem[]
  /** Marks every channel the boss can see read. Returns false when nothing was unread. */
  markAllReadByBoss(): boolean
}

/**
 * Read state is the per-channel `chat_read_mark` the rest of chat already keeps: opening a channel
 * reads its rows, which is what clicking a row does.
 */
export function createBossInbox(db: DatabaseSync): BossInbox {
  return {
    bossInbox() {
      const rows = db
        .prepare(
          `WITH row AS (
             SELECT m.id AS id,
                    m.channel_id AS channel_id,
                    COALESCE(m.thread_id, m.id) AS thread_id,
                    m.author_id AS author_id,
                    m.text AS text,
                    m.created_at AS created_at,
                    (SELECT a.id FROM approval a WHERE a.message_id = m.id) AS approval_id,
                    (SELECT p.id FROM plan p WHERE p.message_id = m.id AND p.status IN ('waiting', 'replan'))
                      AS plan_id,
                    m.test_run_id AS test_run_id,
                    (SELECT a.status FROM approval a WHERE a.message_id = m.id) = 'pending' AS pending,
                    CASE WHEN m.id > COALESCE(r.last_read_id, 0) THEN 1 ELSE 0 END AS unread,
                    CASE
                      WHEN EXISTS (SELECT 1 FROM approval a WHERE a.message_id = m.id) THEN 'approval'
                      -- A drafted plan is a decision the boss owns, not chatter that mentions them
                      -- (T233): it outranks the mention it also is, and carries its own actions.
                      WHEN EXISTS (
                             SELECT 1 FROM plan p WHERE p.message_id = m.id AND p.status IN ('waiting', 'replan')
                           ) THEN 'plan'
                      WHEN m.author_id = ? AND m.text LIKE ? THEN 'waiting'
                      WHEN c.kind = 'dm' THEN 'dm'
                      WHEN EXISTS (SELECT 1 FROM json_each(m.mentions) WHERE value = ?) THEN 'mention'
                      WHEN m.thread_id IS NOT NULL AND EXISTS (
                             SELECT 1 FROM message t
                             WHERE t.author_id = ? AND (t.id = m.thread_id OR t.thread_id = m.thread_id)
                           ) THEN 'thread'
                    END AS kind
             FROM message m
             JOIN channel c ON c.id = m.channel_id
             LEFT JOIN chat_read_mark r ON r.channel_id = m.channel_id
             WHERE m.author_id <> ?
               AND (c.kind = 'channel' OR EXISTS (SELECT 1 FROM json_each(c.members) WHERE value = ?))
           )
           SELECT * FROM (SELECT * FROM row WHERE kind IS NOT NULL ORDER BY id DESC LIMIT ?)
           UNION
           SELECT * FROM row WHERE pending OR plan_id IS NOT NULL
           ORDER BY id DESC`,
        )
        .all(COMPANY_AUTHOR, `${CAPACITY_NOTICE}%`, BOSS, BOSS, BOSS, BOSS, INBOX_LIMIT) as unknown as Row[]
      return rows.map(toItem)
    },

    markAllReadByBoss() {
      const { changes } = db
        .prepare(
          `INSERT INTO chat_read_mark (channel_id, last_read_id)
           SELECT m.channel_id, MAX(m.id)
           FROM message m
           JOIN channel c ON c.id = m.channel_id
           WHERE c.kind = 'channel' OR EXISTS (SELECT 1 FROM json_each(c.members) WHERE value = ?)
           GROUP BY m.channel_id
           ON CONFLICT (channel_id) DO UPDATE SET last_read_id = excluded.last_read_id
           WHERE excluded.last_read_id > chat_read_mark.last_read_id`,
        )
        .run(BOSS)
      return Number(changes) > 0
    },
  }
}

interface Row {
  id: number
  channel_id: string
  thread_id: number
  author_id: string
  text: string
  created_at: string
  approval_id: number | null
  plan_id: number | null
  test_run_id: number | null
  pending: number | null
  unread: number
  kind: BossInboxKind
}

function toItem(row: Row): BossInboxItem {
  return {
    id: messageRowId(row.id),
    messageId: row.id,
    kind: row.kind,
    channelId: row.channel_id,
    threadId: row.thread_id,
    fromId: row.author_id,
    text: row.text,
    createdAt: row.created_at,
    unread: row.unread === 1,
    approvalId: row.approval_id,
    planId: row.plan_id,
    testRunId: row.test_run_id,
  }
}
