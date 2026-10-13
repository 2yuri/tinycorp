import type { DatabaseSync } from 'node:sqlite'
import { type ChannelRemoval, canDeleteChannel } from '../../../shared/channel-removal'
import { dmMembers } from '../../../shared/domain/chat'
import { DEFAULT_DIGEST_SCHEDULE } from '../../../shared/planning/daily-digest'

/** Where a plan's thread goes when the channel it was talked through is deleted. */
const HOME_CHANNEL = 'general'

/**
 * Deleting a channel (T112). The boss's own action: it is not in the MCP chat tools, so an Employee
 * cannot take a conversation away from the Company.
 */
export interface ChannelRemovals {
  /** What deleting `channelId` would take with it. Throws when the channel cannot be deleted. */
  channelRemoval(channelId: string): ChannelRemoval
  /**
   * Deletes a channel with its messages, their threads, the boss's read mark and drafts, the inbox items that
   * point at it and its epic's link. One transaction, so a half-deleted channel cannot outlive a crash.
   */
  deleteChannel(channelId: string): ChannelRemoval
}

/** What deleting a channel must also take off disk: the files its messages carried (T38). */
export interface RemovableAttachments {
  forget(messageIds: readonly number[]): void
}

export function createChannelRemovals(db: DatabaseSync, files?: RemovableAttachments): ChannelRemovals {
  /** The channel as it is stored, with what goes with it, or the reason it stays. */
  function removalOf(channelId: string): ChannelRemoval {
    const id = typeof channelId === 'string' ? channelId.trim().replace(/^#/, '') : ''
    // A DM belongs to the two people in it, and one opens before its first message is stored.
    if (dmMembers(id)) throw new Error('A direct message cannot be deleted')
    const row = db.prepare('SELECT id, kind, name FROM channel WHERE id = ?').get(id) as
      | { id: string; kind: string; name: string }
      | undefined
    if (!row) throw new Error(`There is no channel ${channelId}`)
    if (!canDeleteChannel({ id: row.id, kind: row.kind === 'dm' ? 'dm' : 'channel' })) {
      throw new Error(`#${row.name} is one of the Company’s own channels and stays`)
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM message WHERE channel_id = ?').get(id) as { n: number }
    const epic = db.prepare('SELECT epic_id FROM epic_channel WHERE channel_id = ?').get(id) as
      | { epic_id: number }
      | undefined
    return { channelId: row.id, name: row.name, messages: n, epicId: epic?.epic_id ?? null }
  }

  return {
    channelRemoval: removalOf,

    deleteChannel(channelId) {
      const removal = removalOf(channelId)
      const id = removal.channelId
      // Read before the rows go, so the files can be removed once the transaction has committed.
      const messageIds = (
        db.prepare('SELECT id FROM message WHERE channel_id = ?').all(id) as unknown as { id: number }[]
      ).map((row) => row.id)
      // `approval` and `review` also point at messages, but both only ever post to the Company's own
      // channels (`#general`, `#prs`), which stay — so nothing of theirs can be in here.
      db.exec('BEGIN')
      try {
        run('DELETE FROM thread_answerer WHERE thread_id IN (SELECT id FROM message WHERE channel_id = ?)', id)
        run('DELETE FROM inbox_item_message WHERE message_id IN (SELECT id FROM message WHERE channel_id = ?)', id)
        run('DELETE FROM inbox_item_message WHERE item_id IN (SELECT id FROM inbox_item WHERE channel_id = ?)', id)
        run(
          `DELETE FROM inbox_item
            WHERE channel_id = ? OR message_id IN (SELECT id FROM message WHERE channel_id = ?)`,
          id,
          id,
        )
        run('DELETE FROM message_attachment WHERE message_id IN (SELECT id FROM message WHERE channel_id = ?)', id)
        run('DELETE FROM message_pin WHERE channel_id = ?', id)
        // The digests posted here go with their messages, and the schedule moves back to the
        // channel every Company keeps, so the next one has somewhere to land (T172).
        run('DELETE FROM digest WHERE message_id IN (SELECT id FROM message WHERE channel_id = ?)', id)
        run('UPDATE digest_setting SET channel_id = ? WHERE channel_id = ?', DEFAULT_DIGEST_SCHEDULE.channelId, id)
        run('DELETE FROM chat_read_mark WHERE channel_id = ?', id)
        run('DELETE FROM chat_draft WHERE channel_id = ?', id)
        run('DELETE FROM epic_channel WHERE channel_id = ?', id)
        // A plan outlives the channel it was talked through: the epic stays, so its plan stays, with
        // its thread forgotten and its planning moved to #general (T171).
        const inChannel = '(SELECT id FROM message WHERE channel_id = ?)'
        run(`UPDATE plan SET thread_id = NULL WHERE thread_id IN ${inChannel}`, id)
        run(`UPDATE plan SET message_id = NULL WHERE message_id IN ${inChannel}`, id)
        run(`UPDATE plan_question SET message_id = NULL WHERE message_id IN ${inChannel}`, id)
        run(`UPDATE plan SET channel_id = '${HOME_CHANNEL}' WHERE channel_id = ?`, id)
        // Replies first, so no root is ever gone while a reply still names it.
        run('DELETE FROM message WHERE channel_id = ? AND thread_id IS NOT NULL', id)
        run('DELETE FROM message WHERE channel_id = ?', id)
        run('DELETE FROM channel WHERE id = ?', id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      files?.forget(messageIds)
      return removal
    },
  }

  function run(sql: string, ...params: string[]): void {
    db.prepare(sql).run(...params)
  }
}
