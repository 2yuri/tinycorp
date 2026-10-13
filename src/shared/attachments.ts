/**
 * Files attached to a chat message (decision 37). Every attachment is copied into the Company
 * folder, at `attachments/<messageId>/<name>`, so it outlives the worktree or the Desktop folder
 * it came from and every Employee can read it through MCP.
 */

import { IMAGE_EXTENSIONS, isImageFile } from './files/files'

/** One file attached to a message, as the engine stores it. */
export interface Attachment {
  id: number
  messageId: number
  /** The file name inside the message's folder. Unique within the message. */
  name: string
  /** Its size on disk, in bytes. */
  size: number
  createdAt: string
}

/**
 * What an attachment may be. Both limits are configurable at the engine seam
 * (`CompanyEngineOptions.attachments`); nothing in the design gives the boss a control for them.
 */
export interface AttachmentLimits {
  /** The largest file that may be attached, in bytes. */
  maxBytes: number
  /** The extensions that may be attached, lowercase and without the dot. */
  extensions: readonly string[]
}

/** What a screenshot, a log and a patch need, and nothing that runs. */
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxBytes: 10 * 1024 * 1024,
  extensions: [
    ...IMAGE_EXTENSIONS,
    'txt',
    'log',
    'md',
    'json',
    'csv',
    'yml',
    'yaml',
    'toml',
    'diff',
    'patch',
    'pdf',
    'zip',
  ],
}

/** Whether the chat draws this one inline rather than as a chip. */
export function isImageAttachment(attachment: { name: string }): boolean {
  return isImageFile(attachment.name)
}

/**
 * The file name an attachment is stored under: its own name with every path segment and every
 * character a folder should not carry taken out. Empty when nothing usable is left.
 */
export function attachmentName(name: string): string {
  const base = String(name ?? '')
    .split(/[/\\]/)
    .pop()!
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
  return base.length > 120 ? base.slice(base.length - 120) : base
}

/**
 * A file on its way in: one already on disk — the path an Employee names, inside the Company
 * folder or one of its worktrees — or the bytes the boss picked in the composer.
 */
export type AttachmentSource = { name?: string; path: string } | { name: string; data: Uint8Array }

/** An attachment opened for the viewer: an image carries a data URL, anything else carries none. */
export interface OpenedAttachment {
  id: number
  name: string
  size: number
  /** `data:image/png;base64,…` for an image inside the size limit; null otherwise. */
  dataUrl: string | null
  /** Where the file is on this Mac, for Reveal in Finder. */
  path: string
}
