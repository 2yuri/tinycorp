import type { OpenedFile } from '../../../shared/files/files'
import { nameOf } from './files-model'

/** The kinds the boss may type into. An image, a binary file and one too big stay read-only. */
export const EDITABLE_KINDS = ['text', 'code', 'markdown'] as const

/** One tab's unsaved work: what it now reads, and the file it was opened from. */
export interface Draft {
  text: string
  /** The file's text as it was opened, which is what Discard puts back. */
  opened: string
  /** The digest that text had, which the save hands back so nothing is clobbered. */
  digest: string
}

/** Every tab's draft, by tab key. */
export type Drafts = Readonly<Record<string, Draft>>

export const NO_DRAFTS: Drafts = {}

/**
 * Whether this file can be typed into: a text, code or Markdown file of a place the Company owns,
 * read whole. A file from outside the Company is read-only, and so is one the viewer only has the
 * head of — saving that back would drop everything the viewer never read.
 */
export function isEditable(file: OpenedFile | null, placeId: string | null): boolean {
  if (file === null || placeId === null) return false
  if (file.truncated || file.digest === null || file.text === null) return false
  return (EDITABLE_KINDS as readonly string[]).includes(file.kind)
}

/**
 * Why a file the boss might expect to type into cannot be typed into, or null when there is
 * nothing surprising to say: an image, a binary file and one too big already say what they are,
 * and the line under the viewer says an image is read-only.
 */
export function readOnlyNotice(file: OpenedFile | null, placeId: string | null): string | null {
  if (file === null || isEditable(file, placeId)) return null
  if (file.kind === 'image' || file.kind === 'binary' || file.kind === 'too-big') return null
  if (placeId === null) return 'This file is outside the Company, so the view only reads it.'
  if (file.truncated) return 'Only part of this file was read, so it is read-only: saving it back would drop the rest.'
  return null
}

/** The tab's draft, or null when the boss has not typed into it. */
export function draftOf(drafts: Drafts, key: string | null): Draft | null {
  return key === null ? null : (drafts[key] ?? null)
}

/** What the editor shows: the boss's own text where there is one, else the file as it was read. */
export function textOf(drafts: Drafts, key: string | null, file: OpenedFile | null): string {
  return draftOf(drafts, key)?.text ?? file?.text ?? ''
}

/** The boss typed: the tab keeps their text, and the file it was opened from to go back to. */
export function typedInto(drafts: Drafts, key: string, file: OpenedFile, text: string): Drafts {
  const known = drafts[key]
  const draft: Draft = known ? { ...known, text } : { text, opened: file.text ?? '', digest: file.digest ?? '' }
  return { ...drafts, [key]: draft }
}

/** Discard, and what a save that landed leaves behind: the tab has nothing unsaved any more. */
export function dropDraft(drafts: Drafts, key: string): Drafts {
  if (!(key in drafts)) return drafts
  const next = { ...drafts }
  delete next[key]
  return next
}

/** True while the tab's text is not the file it was opened from. */
export function isDirty(drafts: Drafts, key: string | null): boolean {
  const draft = draftOf(drafts, key)
  return draft !== null && draft.text !== draft.opened
}

/** Every tab with unsaved work in it, by key. */
export function dirtyKeys(drafts: Drafts): string[] {
  return Object.keys(drafts).filter((key) => isDirty(drafts, key))
}

/** Whether anything at all is unsaved, which is what leaving the view has to ask about. */
export function anyDirty(drafts: Drafts): boolean {
  return dirtyKeys(drafts).length > 0
}

/** `⌘S`, and `Ctrl+S` for a boss who is not on a Mac. */
export function isSaveKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey?: boolean }): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's'
}

/** The ask before unsaved work goes: it names the file, and says where a save would write. */
export function unsavedTitle(path: string): string {
  return `Save ${nameOf(path)} first?`
}

export function unsavedBody(path: string, more = 0): string {
  const rest = more > 0 ? ` ${more} other ${more === 1 ? 'file is' : 'files are'} edited too.` : ''
  return `${path} is edited and not saved. Saving writes it to the worktree on disk; discarding puts the file back as it was.${rest}`
}

/** The title over both versions when a save stopped. */
export function conflictTitle(path: string): string {
  return `${nameOf(path)} changed while you were typing`
}

export function conflictBody(holderName: string | null): string {
  const who = holderName ?? 'An Employee'
  return `${who} wrote this file after you opened it, so nothing has been overwritten. Pick the version to keep.`
}
