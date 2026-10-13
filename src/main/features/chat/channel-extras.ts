import type { DatabaseSync } from 'node:sqlite'
import {
  type ChannelSearch,
  normalizeSearch,
  normalizeTopic,
  type PinnedMessage,
  type PinRequest,
} from '../../../shared/channel-extras'
import { BOSS, type Channel, COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { Migration } from '../../core'
import { type MessageRow, REPLY_COUNT, toMessage } from './message-rows'

/**
 * A named channel's topic and member list, the pins on its messages and the search over its bodies
 * (T44). Pins are open to the boss and to Employees over `chat_pin`; the topic and the member list
 * are the boss's, like deleting a channel (T112), so no MCP tool moves them.
 */
export interface ChannelExtras {
  /** Writes a named channel's topic. An empty topic clears it and the view says what it can itself. */
  setChannelTopic(input: { channelId: string; topic: string }): Channel
  /**
   * Sets who belongs to a named channel. An empty list means the whole Company, which is what a
   * channel starts with; every id must be an Employee who has not been fired.
   */
  setChannelMembers(input: { channelId: string; memberIds: string[] }): Channel
  /** Pins a message for its whole channel. Pinning one that is already pinned keeps the first pin. */
  pinMessage(input: PinRequest): PinnedMessage
  /** Unpins a message, and says what was unpinned. */
  unpinMessage(input: { messageId: number }): PinnedMessage
  /** A channel's pinned messages, newest pin first. */
  pins(channelId: string): PinnedMessage[]
  /** The channel's messages whose body contains `text`, newest first. Replies included. */
  searchMessages(query: ChannelSearch): Message[]
}

/** The migration step of the channel extras, appended to the engine's migrations. */
export const CHANNEL_EXTRAS_MIGRATION: Migration = {
  name: 'chat-channel-topic-and-message-pins',
  sql: `
  ALTER TABLE channel ADD COLUMN topic TEXT NOT NULL DEFAULT '';
  CREATE TABLE message_pin (
    message_id INTEGER PRIMARY KEY REFERENCES message (id),
    channel_id TEXT NOT NULL REFERENCES channel (id),
    pinned_by TEXT NOT NULL,
    pinned_at TEXT NOT NULL
  );
  CREATE INDEX message_pin_by_channel ON message_pin (channel_id, pinned_at, message_id);
`,
}

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200

export interface ChannelExtrasOptions {
  db: DatabaseSync
  /** The chat's own channel lookup: `#tech` and a DM id both land on a stored channel. */
  channelOf(channelId: string): Channel
  /** Called after a topic, a member list or a pin changed, so the renderer reloads. */
  changed(): void
}

export function createChannelExtras({ db, channelOf, changed }: ChannelExtrasOptions): ChannelExtras {
  /** The stored named channel, or the reason there is none to edit. */
  function namedChannel(channelId: string): Channel {
    const channel = channelOf(channelId)
    if (channel.kind === 'dm') throw new Error('A direct message has no topic or member list')
    return channel
  }

  function reload(channelId: string): Channel {
    return channelOf(channelId)
  }

  function messageOf(messageId: number): MessageRow {
    if (!Number.isInteger(messageId) || messageId < 1) throw new Error('Missing message id')
    const row = db.prepare(`SELECT m.*, ${REPLY_COUNT} FROM message m WHERE m.id = ?`).get(messageId) as
      | MessageRow
      | undefined
    if (!row) throw new Error(`There is no message ${messageId}`)
    return row
  }

  function pinOf(messageId: number): PinnedMessage {
    const row = db
      .prepare(
        `SELECT m.*, ${REPLY_COUNT}, p.pinned_by, p.pinned_at
         FROM message_pin p JOIN message m ON m.id = p.message_id WHERE p.message_id = ?`,
      )
      .get(messageId) as (MessageRow & PinRow) | undefined
    if (!row) throw new Error(`Message ${messageId} is not pinned`)
    return toPinned(row)
  }

  return {
    setChannelTopic({ channelId, topic }) {
      const channel = namedChannel(channelId)
      db.prepare('UPDATE channel SET topic = ? WHERE id = ?').run(normalizeTopic(topic), channel.id)
      changed()
      return reload(channel.id)
    },

    setChannelMembers({ channelId, memberIds }) {
      const channel = namedChannel(channelId)
      const ids = Array.isArray(memberIds) ? [...new Set(memberIds.filter((id) => typeof id === 'string'))] : []
      for (const id of ids) {
        if (!db.prepare('SELECT 1 FROM employee WHERE id = ? AND fired_at IS NULL').get(id)) {
          throw new Error(`${id} is not an Employee of this Company`)
        }
      }
      db.prepare('UPDATE channel SET members = ? WHERE id = ?').run(JSON.stringify(ids), channel.id)
      changed()
      return reload(channel.id)
    },

    pinMessage({ messageId, byId }) {
      const message = messageOf(messageId)
      requirePinner(db, byId)
      const already = db.prepare('SELECT 1 FROM message_pin WHERE message_id = ?').get(message.id)
      if (!already) {
        db.prepare('INSERT INTO message_pin (message_id, channel_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)').run(
          message.id,
          message.channel_id,
          byId,
          new Date().toISOString(),
        )
        changed()
      }
      return pinOf(message.id)
    },

    unpinMessage({ messageId }) {
      const pin = pinOf(messageOf(messageId).id)
      db.prepare('DELETE FROM message_pin WHERE message_id = ?').run(pin.id)
      changed()
      return pin
    },

    pins(channelId) {
      const channel = channelOf(channelId)
      const rows = db
        .prepare(
          `SELECT m.*, ${REPLY_COUNT}, p.pinned_by, p.pinned_at
           FROM message_pin p JOIN message m ON m.id = p.message_id
           WHERE p.channel_id = ? ORDER BY p.pinned_at DESC, p.message_id DESC`,
        )
        .all(channel.id) as unknown as (MessageRow & PinRow)[]
      return rows.map(toPinned)
    },

    searchMessages({ channelId, text, limit = DEFAULT_SEARCH_LIMIT }) {
      const channel = channelOf(channelId)
      const query = normalizeSearch(text)
      if (!query) return []
      const count = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(Number(limit) || DEFAULT_SEARCH_LIMIT)))
      const rows = db
        .prepare(
          `SELECT m.*, ${REPLY_COUNT} FROM message m
           WHERE m.channel_id = ? AND m.text LIKE ? ESCAPE '\\'
           ORDER BY m.id DESC LIMIT ?`,
        )
        .all(channel.id, `%${escapeLike(query)}%`, count) as unknown as MessageRow[]
      return rows.map(toMessage)
    },
  }
}

/** Only someone the Company knows pins: the boss, the Company itself or an Employee. */
function requirePinner(db: DatabaseSync, byId: string): void {
  if (byId === BOSS || byId === COMPANY_AUTHOR) return
  if (!db.prepare('SELECT 1 FROM employee WHERE id = ?').get(byId)) throw new Error(`Unknown author: ${byId}`)
}

/** `%`, `_` and the escape itself are literal text in a search, not wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/gu, (c) => `\\${c}`)
}

interface PinRow {
  pinned_by: string
  pinned_at: string
}

function toPinned(row: MessageRow & PinRow): PinnedMessage {
  return { ...toMessage(row), pinnedBy: row.pinned_by, pinnedAt: row.pinned_at }
}
