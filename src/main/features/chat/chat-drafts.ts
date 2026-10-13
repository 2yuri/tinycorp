import { statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AttachmentSource } from '../../../shared/attachments'
import {
  DRAFT_LIMITS,
  type Draft,
  type DraftFile,
  type DraftFileBytes,
  type DraftKey,
  isEmptyDraft,
} from '../../../shared/drafts'
import type { Migration } from '../../core'
import type { CheckedSource } from './attachments'

/** The boss's unsent composer text and files, one per conversation (TI-1). */
export interface ChatDrafts {
  /** The draft kept under `key`, without the files that are no longer on disk. Null when there is none. */
  draft(key: string): Draft | null
  /** Keeps the draft under `key`; an empty one deletes it. */
  saveDraft(key: string, draft: Draft): void
  clearDraft(key: string): void
  /** The channels and DMs holding a draft of their own, for the sidebar's pencil. */
  draftedChannels(): string[]
  /**
   * One file of a draft, read for sending. Only a path the draft holds is read, and only through
   * the same checks a send runs, so the renderer cannot use this to read any file it likes.
   */
  draftFile(key: string, path: string): DraftFileBytes
}

/**
 * `channel_id` is the conversation a draft sits in — the thread's channel for a reply box, null for
 * Your Desk — so deleting a channel can take its drafts along.
 */
export const CHAT_DRAFTS_MIGRATION: Migration = {
  name: 'chat-composer-drafts',
  sql: `
  CREATE TABLE chat_draft (
    key TEXT PRIMARY KEY,
    channel_id TEXT,
    text TEXT NOT NULL,
    files TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX chat_draft_by_channel ON chat_draft (channel_id);
`,
}

/**
 * `check` is the attachment store's own: a draft file is read only if it would be attachable as it
 * is now — a kind that may be attached, inside the size limit — so a path the renderer put in a
 * draft cannot read what a message could not carry, and an enormous file is refused unread.
 */
export function createChatDrafts(
  db: DatabaseSync,
  check: (sources: readonly AttachmentSource[]) => CheckedSource[],
): ChatDrafts {
  function stored(key: DraftKey): Draft | null {
    const row = db.prepare('SELECT text, files FROM chat_draft WHERE key = ?').get(key) as
      | { text: string; files: string }
      | undefined
    return row ? { text: row.text, files: JSON.parse(row.files) as DraftFile[] } : null
  }

  /** The channel a key's conversation lives in; a thread whose root is gone has none. */
  function channelOf(key: DraftKey): string | null {
    if (key === 'desk') return null
    if (key.startsWith('channel:')) return key.slice('channel:'.length)
    const row = db.prepare('SELECT channel_id FROM message WHERE id = ?').get(Number(key.slice('thread:'.length))) as
      | { channel_id: string }
      | undefined
    return row?.channel_id ?? null
  }

  return {
    draft(key) {
      const kept = stored(parseKey(key))
      if (!kept) return null
      const files = kept.files.flatMap((file) => {
        const size = fileSize(file.path)
        return size === null ? [] : [{ ...file, size }]
      })
      return { text: kept.text, files }
    },

    saveDraft(key, draft) {
      const id = parseKey(key)
      const checked = parseDraft(draft)
      if (isEmptyDraft(checked)) {
        db.prepare('DELETE FROM chat_draft WHERE key = ?').run(id)
        return
      }
      db.prepare(
        `INSERT INTO chat_draft (key, channel_id, text, files, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET text = excluded.text, files = excluded.files, updated_at = excluded.updated_at`,
      ).run(id, channelOf(id), checked.text, JSON.stringify(checked.files), new Date().toISOString())
    },

    clearDraft(key) {
      db.prepare('DELETE FROM chat_draft WHERE key = ?').run(parseKey(key))
    },

    draftedChannels() {
      const rows = db.prepare("SELECT channel_id AS id FROM chat_draft WHERE key LIKE 'channel:%'").all() as {
        id: string
      }[]
      return rows.map((row) => row.id)
    },

    draftFile(key, path) {
      const held = stored(parseKey(key))?.files.find((file) => file.path === path)
      if (!held) throw new Error('That file is not in the draft')
      if (fileSize(held.path) === null) throw new Error(`${held.name} is no longer where it was attached from`)
      const [checked] = check([{ name: held.name, path: held.path }])
      if (!checked) throw new Error(`${held.name} can no longer be sent`)
      return { name: checked.name, data: checked.read() }
    },
  }
}

/** Its size when `path` is still a file, null when it was deleted, moved or replaced by a folder. */
function fileSize(path: string): number | null {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

function parseKey(value: unknown): DraftKey {
  if (value === 'desk') return 'desk'
  if (typeof value === 'string') {
    if (/^thread:[1-9]\d*$/.test(value)) return value as DraftKey
    const channel = /^channel:(\S+)$/.exec(value)?.[1]
    if (channel) return `channel:${channel}`
  }
  throw new Error('Missing draft key')
}

/** A draft from the renderer, checked field by field: text, then absolute paths to files. */
function parseDraft(value: unknown): Draft {
  if (typeof value !== 'object' || value === null) throw new Error('Missing draft')
  const draft = value as Record<string, unknown>
  const text = typeof draft['text'] === 'string' ? draft['text'] : ''
  if (text.length > DRAFT_LIMITS.textLength) throw new Error('The draft is too long to keep')
  const files = Array.isArray(draft['files']) ? draft['files'] : []
  if (files.length > DRAFT_LIMITS.files) throw new Error('The draft holds too many files to keep')
  return { text, files: files.map(parseFile) }
}

function parseFile(value: unknown): DraftFile {
  const file = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const path = file['path']
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('A draft file needs its full path')
  const name = typeof file['name'] === 'string' && file['name'] !== '' ? file['name'] : basename(path)
  const size = typeof file['size'] === 'number' && file['size'] >= 0 ? file['size'] : 0
  return { path, name, size }
}
