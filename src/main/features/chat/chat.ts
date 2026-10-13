import type { DatabaseSync } from 'node:sqlite'
import type { AttachmentSource } from '../../../shared/attachments'
import {
  BOSS,
  type Channel,
  type ChatQuery,
  COMPANY_AUTHOR,
  DEFAULT_CHANNELS,
  dmMembers,
  type Mentionable,
  type Message,
  type MessageKind,
  type NewMessage,
  type NewReply,
  parseMentions,
} from '../../../shared/domain/chat'
import type { DailyDigest } from '../../../shared/planning/daily-digest'
import type { Migration } from '../../core'
import { type BossInbox, createBossInbox } from '../inbox'
import { digestsOfMany } from '../planning'
import { type AgentPairs, createAgentPairs } from './agent-pairs'
import { type Attachments, type AttachmentsOptions, type CheckedSource, createAttachments } from './attachments'
import { type ChannelExtras, createChannelExtras } from './channel-extras'
import { type ChannelRemovals, createChannelRemovals } from './channel-removal'
import { type ChatDrafts, createChatDrafts } from './chat-drafts'
import { type BossReadMarks, createBossReadMarks } from './chat-read-marks'
import { createEmployeeChats, type EmployeeChats } from './employee-chats'
import { type MessageRow, REPLY_COUNT, toMessage } from './message-rows'
import { createThreadAudiences, type ThreadAudiences } from './thread-audience'

/**
 * The chat of one Company: named channels, DMs and threads.
 * Every method validates its input, since callers include the renderer and Employees over MCP.
 */
export interface Chat
  extends BossReadMarks,
    BossInbox,
    EmployeeChats,
    AgentPairs,
    ChannelRemovals,
    ChannelExtras,
    ThreadAudiences,
    ChatDrafts,
    Attachments {
  /** Named channels in their fixed order, then every opened DM. */
  channels(): Channel[]
  post(input: NewMessage): Message
  reply(input: NewReply): Message
  read(query: ChatQuery): Message[]
  /**
   * Posts the daily digest the app wrote for itself (T172): a `digest` message, stored with the
   * day it sums up so the same day can never be posted twice. It is not a chat post from an
   * Employee, so it wakes nobody and enters no inbox.
   */
  postDigest(input: NewDigest): Message
  /** The Employees that can be mentioned or DMed. */
  people(): Mentionable[]
}

/** The daily digest as the engine hands it to the chat. */
export interface NewDigest {
  channelId: string
  /** The one line the message itself carries, for search and for anything that has no card. */
  text: string
  digest: DailyDigest
}

/** The chat's migration step, appended to the engine's migrations. */
export const CHAT_MIGRATION: Migration = {
  name: 'chat-tables',
  sql: `
  CREATE TABLE channel (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    members TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL
  );
  CREATE TABLE message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channel (id),
    thread_id INTEGER REFERENCES message (id),
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    mentions TEXT NOT NULL,
    mentions_channel INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX message_by_channel ON message (channel_id, thread_id, id);
  ${DEFAULT_CHANNELS.map(
    (name, position) =>
      `INSERT INTO channel (id, kind, name, position) VALUES ('${name}', 'channel', '${name}', ${position});`,
  ).join('\n')}
`,
}

/** The Target a message announces (T151), so the chat can hang the target card under it. */
export const MESSAGE_TARGET_MIGRATION: Migration = {
  name: 'chat-message-target',
  sql: `ALTER TABLE message ADD COLUMN target_id INTEGER REFERENCES target(id)`,
}

/** The test attempt a message is about (T174), so the chat can hang the evidence card under it. */
export const MESSAGE_TEST_RUN_MIGRATION: Migration = {
  name: 'chat-message-test-run',
  sql: `ALTER TABLE message ADD COLUMN test_run_id INTEGER REFERENCES test_run(id)`,
}

const DEFAULT_READ_LIMIT = 50
const MAX_READ_LIMIT = 200

/**
 * `notify` is called with every new message, after it is stored; `changed` with everything else the
 * chat can change on its own, such as a topic, a member list or a pin (T44).
 */
export function createChat(
  db: DatabaseSync,
  notify: (message: Message) => void,
  changed: () => void = () => {},
  attachments: Pick<AttachmentsOptions, 'folder' | 'limits' | 'excludeFromGit'> = { folder: '' },
): Chat {
  const files = createAttachments({ db, ...attachments })

  function people(): Mentionable[] {
    return db
      .prepare('SELECT id, name FROM employee WHERE fired_at IS NULL ORDER BY desk')
      .all() as unknown as Mentionable[]
  }

  function requireAuthor(authorId: string): void {
    if (authorId === BOSS || authorId === COMPANY_AUTHOR) return
    if (!db.prepare('SELECT 1 FROM employee WHERE id = ?').get(authorId)) {
      throw new Error(`Unknown author: ${authorId}`)
    }
  }

  function requireTestRun(testRunId: number | undefined): void {
    if (testRunId === undefined) return
    if (!Number.isInteger(testRunId) || !db.prepare('SELECT 1 FROM test_run WHERE id = ?').get(testRunId)) {
      throw new Error(`There is no test run ${String(testRunId)}`)
    }
  }

  function requireTarget(targetId: number | undefined): void {
    if (targetId === undefined) return
    if (!Number.isInteger(targetId) || !db.prepare('SELECT 1 FROM target WHERE id = ?').get(targetId)) {
      throw new Error(`There is no target ${String(targetId)}`)
    }
  }

  /** A message must say something — unless it carries a file, which a screenshot alone does. */
  function requireText(text: string, sources: readonly AttachmentSource[] = []): string {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed && sources.length === 0) throw new Error('A message cannot be empty')
    return trimmed
  }

  function normalize(channelId: string): string {
    return typeof channelId === 'string' ? channelId.trim().replace(/^#/, '') : ''
  }

  /** The stored channel, or for a DM between real participants, a channel that does not exist yet. */
  function findChannel(channelId: string): { channel: Channel; stored: boolean } {
    const id = normalize(channelId)
    const row = db.prepare('SELECT id, kind, name, members, topic FROM channel WHERE id = ?').get(id) as
      | ChannelRow
      | undefined
    if (row) return { channel: toChannel(row), stored: true }
    const members = dmMembers(id)
    const known = members?.every((m) => m === BOSS || db.prepare('SELECT 1 FROM employee WHERE id = ?').get(m))
    if (!members || !known || members[0] === members[1]) throw new Error(`There is no channel ${channelId}`)
    return { channel: { id, kind: 'dm', name: '', members: [...members].sort(), topic: '' }, stored: false }
  }

  /**
   * One message and its files, written but not yet announced. The caller checks the files first, so
   * nothing is written — not even the DM a first message opens — when one of them is over the limit;
   * here they are copied in once the message has an id, which is the folder they live in (decision 37).
   */
  function write(
    channelId: string,
    threadId: number | null,
    authorId: string,
    text: string,
    carried: string[] = [],
    checked: readonly CheckedSource[] = [],
    targetId: number | null = null,
    kind: MessageKind = 'post',
    testRunId: number | null = null,
  ): Message {
    const who = people()
    const { mentions: named, mentionsChannel } = parseMentions(text, who)
    // `carried` lets a caller mention someone the text does not name, e.g. the boss on an approval.
    const known = [BOSS, ...who.map((p) => p.id)]
    const mentions = [...new Set([...named, ...carried.filter((id) => known.includes(id))])]
    const createdAt = new Date().toISOString()
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO message (channel_id, thread_id, author_id, text, mentions, mentions_channel, created_at, target_id, kind, test_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channelId,
        threadId,
        authorId,
        text,
        JSON.stringify(mentions),
        mentionsChannel ? 1 : 0,
        createdAt,
        targetId,
        kind,
        testRunId,
      )
    const id = Number(lastInsertRowid)
    const stored = files.add(id, checked)
    const message: Message = {
      id,
      kind,
      channelId,
      threadId,
      authorId,
      text,
      mentions,
      mentionsChannel,
      replyCount: 0,
      createdAt,
      ...(stored.length > 0 && { attachments: stored }),
      ...(targetId !== null && { targetId }),
      ...(testRunId !== null && { testRunId }),
    }
    return message
  }

  /** Writes a message and tells whoever is listening. Everything but the digest goes through here. */
  function insert(...args: Parameters<typeof write>): Message {
    const message = write(...args)
    notify(message)
    return message
  }

  return {
    channels() {
      const rows = db
        .prepare(`SELECT id, kind, name, members, topic FROM channel ORDER BY kind = 'dm', position, rowid`)
        .all() as unknown as ChannelRow[]
      return rows.map(toChannel)
    },

    post({ authorId, channelId, text, mentions, attachments: sources, targetId, testRunId }) {
      requireAuthor(authorId)
      const body = requireText(text, sources)
      requireTarget(targetId)
      requireTestRun(testRunId)
      const { channel, stored } = findChannel(channelId)
      if (channel.kind === 'dm' && !channel.members.includes(authorId)) {
        throw new Error('You are not in this DM')
      }
      const checked = files.check(sources ?? [])
      if (!stored) {
        db.prepare(
          `INSERT INTO channel (id, kind, name, members, position)
           VALUES (?, 'dm', '', ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM channel))`,
        ).run(channel.id, JSON.stringify(channel.members))
      }
      return insert(channel.id, null, authorId, body, mentions, checked, targetId ?? null, 'post', testRunId ?? null)
    },

    reply({ authorId, messageId, text, attachments: sources }) {
      requireAuthor(authorId)
      const body = requireText(text, sources)
      const target = db.prepare('SELECT id, channel_id, thread_id FROM message WHERE id = ?').get(messageId) as
        | { id: number; channel_id: string; thread_id: number | null }
        | undefined
      if (!target) throw new Error(`There is no message ${messageId}`)
      const { channel } = findChannel(target.channel_id)
      if (channel.kind === 'dm' && !channel.members.includes(authorId)) {
        throw new Error('You are not in this DM')
      }
      return insert(target.channel_id, target.thread_id ?? target.id, authorId, body, [], files.check(sources ?? []))
    },

    read({ channelId, threadId, limit = DEFAULT_READ_LIMIT }) {
      const { channel } = findChannel(channelId)
      const count = Math.max(1, Math.min(MAX_READ_LIMIT, Math.floor(Number(limit) || DEFAULT_READ_LIMIT)))
      const rows = (threadId === undefined
        ? db
            .prepare(
              `SELECT m.*, ${REPLY_COUNT}
                 FROM message m WHERE m.channel_id = ? AND m.thread_id IS NULL
                 ORDER BY m.id DESC LIMIT ?`,
            )
            .all(channel.id, count)
        : db
            .prepare(
              `SELECT m.*, ${REPLY_COUNT}
                 FROM message m WHERE m.channel_id = ? AND (m.id = ? OR m.thread_id = ?)
                 ORDER BY m.id DESC LIMIT ?`,
            )
            .all(channel.id, threadId, threadId, count)) as unknown as MessageRow[]
      return withDigests(withAttachments(rows.reverse().map(toMessage)))
    },

    postDigest({ channelId, text, digest }) {
      const { channel, stored } = findChannel(channelId)
      if (!stored || channel.kind !== 'channel') throw new Error(`There is no channel ${channelId}`)
      const body = requireText(text)
      // The message and its day go in together: the UNIQUE day is what makes one day one digest.
      db.exec('BEGIN')
      let written: Message
      try {
        written = write(channel.id, null, COMPANY_AUTHOR, body, [], [], null, 'digest')
        db.prepare('INSERT INTO digest (message_id, day, since, until, body) VALUES (?, ?, ?, ?, ?)').run(
          written.id,
          digest.day,
          digest.since,
          digest.until,
          JSON.stringify(digest),
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      // Announced only once the day is filed: a listener must never see a digest that rolled back.
      const message = { ...written, digest }
      notify(message)
      return message
    },

    people,
    ...files,
    ...createChannelExtras({
      db,
      channelOf: (channelId) => findChannel(channelId).channel,
      changed,
    }),
    ...createChannelRemovals(db, files),
    ...createEmployeeChats(db),
    ...createAgentPairs(db),
    ...createThreadAudiences(db),
    ...createChatDrafts(db, files.check),
    ...createBossInbox(db),
    ...createBossReadMarks(db, (channelId) => {
      const { channel, stored } = findChannel(channelId)
      if (!stored) throw new Error(`There is no channel ${channelId}`)
      return channel.id
    }),
  }

  /** Hangs each digest on its message; every other message carries no `digest` key at all. */
  function withDigests(messages: Message[]): Message[] {
    const ids = messages.filter((message) => message.kind === 'digest').map((message) => message.id)
    if (ids.length === 0) return messages
    const byMessage = digestsOfMany(db, ids)
    return messages.map((message) => {
      const held = byMessage.get(message.id)
      return held ? { ...message, digest: held } : message
    })
  }

  /** Hangs each message's files on it; a message with none carries no `attachments` key at all. */
  function withAttachments(messages: Message[]): Message[] {
    const byMessage = files.attachmentsOfMany(messages.map((m) => m.id))
    if (byMessage.size === 0) return messages
    return messages.map((message) => {
      const held = byMessage.get(message.id)
      return held ? { ...message, attachments: held } : message
    })
  }
}

interface ChannelRow {
  id: string
  kind: string
  name: string
  members: string
  topic: string
}

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    kind: row.kind === 'dm' ? 'dm' : 'channel',
    name: row.name,
    members: JSON.parse(row.members) as string[],
    topic: row.topic ?? '',
  }
}
