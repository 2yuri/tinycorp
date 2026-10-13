import type { DatabaseSync } from 'node:sqlite'
import { BOSS } from '../../../shared/domain/chat'
import type { EmployeeConversation } from '../../../shared/employee-chats'

/** What the Employee drawer's Chats tab reads: the conversations one Employee takes part in (T72). */
export interface EmployeeChats {
  /**
   * The Employee's conversations, the one with the newest message first: every DM they are in —
   * with the boss and with teammates — and every named channel they post in or belong to. A
   * conversation with no message yet is left out, since there is nothing to read along.
   *
   * `unread` counts what the boss has not read, so the drawer marks the same messages the Chat view
   * would; a DM between two Employees counts too, even though `bossUnread()` leaves it out.
   */
  employeeConversations(employeeId: string): EmployeeConversation[]
}

interface Row {
  id: string
  kind: string
  name: string
  members: string
  last_id: number
  author_id: string
  text: string
  created_at: string
  unread: number
}

export function createEmployeeChats(db: DatabaseSync): EmployeeChats {
  return {
    employeeConversations(employeeId) {
      if (typeof employeeId !== 'string' || !db.prepare('SELECT 1 FROM employee WHERE id = ?').get(employeeId)) {
        throw new Error(`Unknown employee: ${employeeId}`)
      }
      const rows = db
        .prepare(
          `SELECT c.id, c.kind, c.name, c.members,
                  m.id AS last_id, m.author_id, m.text, m.created_at,
                  (SELECT COUNT(*) FROM message u
                     LEFT JOIN chat_read_mark r ON r.channel_id = u.channel_id
                    WHERE u.channel_id = c.id
                      AND u.author_id <> ?
                      AND u.id > COALESCE(r.last_read_id, 0)) AS unread
             FROM channel c
             JOIN message m ON m.id = (SELECT MAX(id) FROM message WHERE channel_id = c.id)
            WHERE EXISTS (SELECT 1 FROM json_each(c.members) WHERE value = ?)
               OR (c.kind = 'channel'
                   AND EXISTS (SELECT 1 FROM message p WHERE p.channel_id = c.id AND p.author_id = ?))
            ORDER BY m.id DESC`,
        )
        .all(BOSS, employeeId, employeeId) as unknown as Row[]
      return rows.map((row) => toConversation(row, employeeId))
    },
  }
}

function toConversation(row: Row, employeeId: string): EmployeeConversation {
  const kind = row.kind === 'dm' ? 'dm' : 'channel'
  const members = JSON.parse(row.members) as string[]
  return {
    channelId: row.id,
    kind,
    name: row.name,
    members,
    counterpartId: kind === 'dm' ? (members.find((m) => m !== employeeId) ?? employeeId) : null,
    last: { id: row.last_id, authorId: row.author_id, text: row.text, createdAt: row.created_at },
    unread: row.unread,
    postable: kind === 'channel' || members.includes(BOSS),
  }
}
