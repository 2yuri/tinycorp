/**
 * What the boss typed in a composer and has not sent (TI-1): kept per conversation, so it is still
 * there after switching away or restarting the app. A file is kept by its path and never copied —
 * one deleted or moved since comes back without it, and the text still comes back.
 */

/** Which composer a draft belongs to: a channel or DM, a thread's reply box, or Your Desk. */
export type DraftKey = `channel:${string}` | `thread:${number}` | 'desk'

export const draftKeys = {
  channel: (channelId: string): DraftKey => `channel:${channelId}`,
  thread: (rootId: number): DraftKey => `thread:${rootId}`,
  desk: 'desk' as DraftKey,
}

/** A file held in a draft: where it is on this machine, and what the composer shows for it. */
export interface DraftFile {
  path: string
  name: string
  size: number
}

/** A draft file read for sending: the bytes cross to the renderer and back with the message. */
export interface DraftFileBytes {
  name: string
  data: Uint8Array
}

export interface Draft {
  text: string
  files: DraftFile[]
}

/** How much one draft may hold, so a stuck composer cannot fill the Company database. */
export const DRAFT_LIMITS = { textLength: 100_000, files: 20 } as const

/** Whether there is anything to keep: blank text and no files is no draft at all. */
export function isEmptyDraft(draft: Draft): boolean {
  return draft.text.trim() === '' && draft.files.length === 0
}
