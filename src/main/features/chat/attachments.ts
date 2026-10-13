import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  type Attachment,
  type AttachmentLimits,
  type AttachmentSource,
  attachmentName,
  DEFAULT_ATTACHMENT_LIMITS,
  isImageAttachment,
  type OpenedAttachment,
} from '../../../shared/attachments'
import { extensionOf, sizeLabel } from '../../../shared/files/files'
import type { Migration } from '../../core'
import { excludeCompanyDataFromGit } from '../../core'
import { IMAGE_TYPES } from '../files'

/** The folder inside a Company that holds every attachment, one folder per message. */
export const ATTACHMENTS_FOLDER = 'attachments'

/** The attachments' migration step, appended to the engine's migrations. */
export const ATTACHMENTS_MIGRATION: Migration = {
  name: 'chat-message-attachments',
  sql: `
  CREATE TABLE message_attachment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES message (id),
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX message_attachment_by_message ON message_attachment (message_id, id);
`,
}

/** A source that passed every limit, with its bytes resolved and its final name chosen. */
export interface CheckedSource {
  name: string
  size: number
  read(): Uint8Array
}

/** What the chat exposes about attachments; the boss and Employees both read through it. */
export interface Attachments {
  /** What a message carries, oldest first. Empty when it carries nothing. */
  attachmentsOf(messageId: number): Attachment[]
  /** The same for several messages at once, by message id; messages with none are left out. */
  attachmentsOfMany(messageIds: number[]): Map<number, Attachment[]>
  /** Where one attachment is on this Mac. Throws when there is no such attachment. */
  attachmentPath(id: number): string
  /** One attachment read for the viewer: an image comes back as a data URL. */
  openAttachment(id: number): OpenedAttachment
  /** The limits this Company attaches under, so the composer can refuse before it sends. */
  attachmentLimits(): AttachmentLimits
}

/** Everything the chat itself needs, including what only the chat may do. */
export interface AttachmentStore extends Attachments {
  /**
   * Checks sources against the limits, before any message is written: a post with one file too
   * big posts nothing. Throws with the reason, naming the file.
   */
  check(sources: readonly AttachmentSource[]): CheckedSource[]
  /** Writes checked sources under the message and records them. */
  add(messageId: number, checked: readonly CheckedSource[]): Attachment[]
  /** Forgets the attachments of these messages, files and rows, e.g. a deleted channel. */
  forget(messageIds: readonly number[]): void
}

export interface AttachmentsOptions {
  db: DatabaseSync
  /** The Company folder. Attachments live in `attachments/<messageId>/` under it. */
  folder: string
  limits?: AttachmentLimits
  /**
   * Keeps the store out of the repo when the Company folder sits in a checkout. Defaults to
   * `info/exclude` through the `git` command line; tests inject their own.
   */
  excludeFromGit?: (folder: string) => void
}

export function createAttachments({
  db,
  folder,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  excludeFromGit = excludeCompanyDataFromGit,
}: AttachmentsOptions): AttachmentStore {
  const root = join(resolve(folder), ATTACHMENTS_FOLDER)
  let excluded = false

  /** The store's folder, made on first use and kept out of whatever checkout it landed in. */
  function makeRoot(): void {
    if (!folder) throw new Error('This Company has no folder to keep attachments in')
    mkdirSync(root, { recursive: true })
    if (excluded) return
    excluded = true
    excludeFromGit(resolve(folder))
  }

  function rowsOf(messageIds: readonly number[]): Attachment[] {
    if (messageIds.length === 0) return []
    const places = messageIds.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT id, message_id, name, size, created_at FROM message_attachment
         WHERE message_id IN (${places}) ORDER BY id`,
      )
      .all(...messageIds) as unknown as AttachmentRow[]
    return rows.map(toAttachment)
  }

  function pathOf(attachment: Attachment): string {
    return join(root, String(attachment.messageId), attachment.name)
  }

  function find(id: number): Attachment {
    const row = db
      .prepare('SELECT id, message_id, name, size, created_at FROM message_attachment WHERE id = ?')
      .get(id) as AttachmentRow | undefined
    if (!row) throw new Error(`There is no attachment ${id}`)
    return toAttachment(row)
  }

  return {
    attachmentLimits: () => limits,

    attachmentsOf: (messageId) => rowsOf([messageId]),

    attachmentsOfMany(messageIds) {
      const byMessage = new Map<number, Attachment[]>()
      for (const attachment of rowsOf([...new Set(messageIds)])) {
        const held = byMessage.get(attachment.messageId)
        if (held) held.push(attachment)
        else byMessage.set(attachment.messageId, [attachment])
      }
      return byMessage
    },

    attachmentPath: (id) => pathOf(find(id)),

    openAttachment(id) {
      const attachment = find(id)
      const path = pathOf(attachment)
      const image = isImageAttachment(attachment) && attachment.size <= limits.maxBytes
      return {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        path,
        dataUrl: image && existsSync(path) ? dataUrl(attachment.name, readFileSync(path)) : null,
      }
    },

    check(sources) {
      const taken = new Set<string>()
      return sources.map((source) => {
        const given = attachmentName(source.name ?? ('path' in source ? source.path : ''))
        if (!given) throw new Error('An attachment needs a file name')
        const name = uniqueName(taken, given)
        const extension = extensionOf(name)
        if (!limits.extensions.includes(extension)) {
          throw new Error(`${name} is not a kind of file you can attach (${limits.extensions.join(', ')})`)
        }
        if ('data' in source) {
          const data = source.data
          if (data.byteLength > limits.maxBytes) throw new Error(tooBig(name, data.byteLength, limits))
          return { name, size: data.byteLength, read: () => data }
        }
        const from = resolve(source.path)
        const stat = statOf(from)
        if (!stat) throw new Error(`There is no file at ${source.path}`)
        if (!stat.isFile()) throw new Error(`${source.path} is not a file`)
        const size = Number(stat.size)
        if (size > limits.maxBytes) throw new Error(tooBig(name, size, limits))
        return { name, size, read: () => readFileSync(from) }
      })
    },

    add(messageId, checked) {
      if (checked.length === 0) return []
      makeRoot()
      const into = join(root, String(messageId))
      mkdirSync(into, { recursive: true })
      const createdAt = new Date().toISOString()
      const stored: Attachment[] = []
      for (const source of checked) {
        writeFileSync(join(into, source.name), source.read())
        const { lastInsertRowid } = db
          .prepare('INSERT INTO message_attachment (message_id, name, size, created_at) VALUES (?, ?, ?, ?)')
          .run(messageId, source.name, source.size, createdAt)
        stored.push({ id: Number(lastInsertRowid), messageId, name: source.name, size: source.size, createdAt })
      }
      return stored
    },

    forget(messageIds) {
      const ids = [...new Set(messageIds)]
      if (ids.length === 0) return
      const places = ids.map(() => '?').join(', ')
      db.prepare(`DELETE FROM message_attachment WHERE message_id IN (${places})`).run(...ids)
      for (const messageId of ids) rmSync(join(root, String(messageId)), { recursive: true, force: true })
    },
  }
}

function tooBig(name: string, size: number, limits: AttachmentLimits): string {
  return `${name} is ${sizeLabel(size)}, over the ${sizeLabel(limits.maxBytes)} an attachment may be`
}

/** `shot.png` twice in one message becomes `shot.png` and `shot-2.png`. */
function uniqueName(taken: Set<string>, name: string): string {
  if (!name) return name
  let candidate = name
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const extension = dot <= 0 ? '' : name.slice(dot)
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${extension}`
  taken.add(candidate)
  return candidate
}

function statOf(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function dataUrl(name: string, bytes: Buffer): string {
  return `data:${IMAGE_TYPES[extensionOf(name)] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`
}

interface AttachmentRow {
  id: number
  message_id: number
  name: string
  size: number
  created_at: string
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.message_id,
    name: row.name,
    size: row.size,
    createdAt: row.created_at,
  }
}
