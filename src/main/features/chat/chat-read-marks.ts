import type { DatabaseSync } from 'node:sqlite'
import { BOSS, type BossUnread } from '../../../shared/domain/chat'
import type { Migration } from '../../core'

/** What the boss has read: the newest message id seen per channel. */
export interface BossReadMarks {
  /**
   * What is unread and what has been read, for named channels and the boss's DMs: the counts a
   * sidebar line is drawn bold by, and the marks the Inbox's New divider is placed from (T251).
   */
  bossUnread(): BossUnread
  /** Marks everything in the channel read. Returns false when it already was. */
  markReadByBoss(channelId: string): boolean
}

/** History from before read marks existed counts as read. */
export const CHAT_READ_MARKS_MIGRATION: Migration = {
  name: 'chat-boss-read-marks',
  sql: `
  CREATE TABLE chat_read_mark (
    channel_id TEXT PRIMARY KEY REFERENCES channel (id),
    last_read_id INTEGER NOT NULL
  );
  INSERT INTO chat_read_mark (channel_id, last_read_id)
    SELECT channel_id, MAX(id) FROM message GROUP BY channel_id;
`,
}

/** `resolveChannel` returns the stored channel's id, throwing for an unknown one. */
export function createBossReadMarks(db: DatabaseSync, resolveChannel: (channelId: string) => string): BossReadMarks {
  return {
    bossUnread() {
      const rows = db
        .prepare(
          `SELECT m.channel_id AS id, COUNT(*) AS n
           FROM message m
           JOIN channel c ON c.id = m.channel_id
           LEFT JOIN chat_read_mark r ON r.channel_id = m.channel_id
           WHERE m.author_id <> ?
             AND m.id > COALESCE(r.last_read_id, 0)
             AND (c.kind = 'channel' OR EXISTS (SELECT 1 FROM json_each(c.members) WHERE value = ?))
           GROUP BY m.channel_id`,
        )
        .all(BOSS, BOSS) as { id: string; n: number }[]
      const marks = db.prepare(`SELECT channel_id AS id, last_read_id AS mark FROM chat_read_mark`).all() as {
        id: string
        mark: number
      }[]
      return {
        counts: Object.fromEntries(rows.map((row) => [row.id, row.n])),
        readMarks: Object.fromEntries(marks.map((row) => [row.id, row.mark])),
      }
    },

    markReadByBoss(channelId) {
      const id = resolveChannel(channelId)
      const { changes } = db
        .prepare(
          `INSERT INTO chat_read_mark (channel_id, last_read_id)
           SELECT channel_id, MAX(id) FROM message WHERE channel_id = ? GROUP BY channel_id
           ON CONFLICT (channel_id) DO UPDATE SET last_read_id = excluded.last_read_id
           WHERE excluded.last_read_id > chat_read_mark.last_read_id`,
        )
        .run(id)
      return Number(changes) > 0
    },
  }
}
