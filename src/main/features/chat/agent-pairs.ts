import type { DatabaseSync } from 'node:sqlite'
import type { AgentPair } from '../../../shared/agent-pairs'
import { BOSS } from '../../../shared/domain/chat'

/** What the sidebar's Between agents section reads: every DM two Employees hold with each other (T77). */
export interface AgentPairs {
  /**
   * One row per pair, the one with the newest message first. A pair with no message yet is left
   * out, since there is nothing to read; `unread` counts what the boss has not read, the same read
   * marks the Chat view sets, so the section can mark a pair the boss has not looked at.
   */
  agentPairs(): AgentPair[]
}

interface Row {
  id: string
  members: string
  last_at: string
  unread: number
}

export function createAgentPairs(db: DatabaseSync): AgentPairs {
  return {
    agentPairs() {
      const rows = db
        .prepare(
          `SELECT c.id, c.members, m.created_at AS last_at,
                  (SELECT COUNT(*) FROM message u
                     LEFT JOIN chat_read_mark r ON r.channel_id = u.channel_id
                    WHERE u.channel_id = c.id
                      AND u.author_id <> ?
                      AND u.id > COALESCE(r.last_read_id, 0)) AS unread
             FROM channel c
             JOIN message m ON m.id = (SELECT MAX(id) FROM message WHERE channel_id = c.id)
            WHERE c.kind = 'dm'
              AND NOT EXISTS (SELECT 1 FROM json_each(c.members) WHERE value = ?)
            ORDER BY m.id DESC`,
        )
        .all(BOSS, BOSS) as unknown as Row[]
      return rows.map((row) => ({
        channelId: row.id,
        members: JSON.parse(row.members) as string[],
        lastAt: row.last_at,
        unread: row.unread,
      }))
    },
  }
}
