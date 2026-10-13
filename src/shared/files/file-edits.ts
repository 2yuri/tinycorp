/**
 * Editing and creating files in the Files view (T122). The viewer reads; this is what the boss
 * needs to write: what a save carries, what comes back when the file changed underneath, and the
 * rules a new path has to keep. The words are the design's (`design/screens/CwBoJ.png`).
 *
 * A save is a write to a worktree on disk, never a commit: git is left to the Employee.
 */

import { isAbsolutePath } from '../platform/absolute-path'
import type { OpenedFile } from './files'

/** What the head says beside the path while the boss has unsaved work. */
export const EDITED_LABEL = 'Edited, not saved'

/** The line under the viewer once a file can be written. */
export const EDIT_FOOTER =
  'Editing writes to the worktree on disk. Markdown, text and code only — an image is read-only.'

/** What the boss sends back to write a file to disk. */
export interface FileSaveRequest {
  /** Relative to the place, as the file was opened. */
  path: string
  /** The whole file as the boss has it now. */
  text: string
  /** The digest the file carried when it was opened; a file that changed since is not overwritten. */
  digest: string
}

/** Both versions of a file that changed underneath the boss while they were typing. */
export interface FileConflict {
  path: string
  /** What is on disk now: whoever else wrote it while the boss had it open. */
  theirs: string
  /** The digest `theirs` has, so a boss who keeps their own can save over exactly that. */
  theirDigest: string
  /** What the boss typed and tried to save. */
  yours: string
}

/** A save either landed, with the file as it now reads, or stopped with both versions to pick from. */
export type FileSaveResult = { saved: true; file: OpenedFile } | { saved: false; conflict: FileConflict }

/** The folder git owns, which nothing the app writes ever goes into. */
export const GIT_FOLDER = '.git'

/**
 * Why a path cannot be created inside a place, or null when it can. The same rules answer for the
 * dialog the boss types into and for the main process, which never trusts the answer it was given.
 */
export function newFileRefusal(path: string): string | null {
  const wanted = path.trim()
  if (wanted === '') return 'Name the file, for example docs/notes.md.'
  if (isAbsolutePath(wanted)) {
    return 'A new file goes inside this place, so its path starts at the place, not at the disk.'
  }
  if (wanted.endsWith('/')) return 'That names a folder. Name the file in it too.'
  const parts = wanted.split(/[\\/]/)
  if (parts.includes('..')) return 'A new file goes inside this place: a path cannot climb out of it with “..”.'
  if (parts.includes(GIT_FOLDER)) return 'Nothing is written into .git — that folder is git’s own.'
  return null
}

/** The path a new file lands at: what the boss typed, under the folder the tree has chosen. */
export function newFilePath(folder: string, typed: string): string {
  const name = typed.trim().replace(/^\/+/, '')
  const inside = folder.replace(/\/+$/, '')
  return inside === '' ? name : `${inside}/${name}`
}

/** What the boss's box starts with: the chosen folder, ready for a name after it. */
export function newFileStart(folder: string | null): string {
  return folder === null || folder === '' ? '' : `${folder.replace(/\/+$/, '')}/`
}

/**
 * The warning above the file while whoever holds the ticket has a Session running in that
 * worktree. It is a warning and not a lock: the boss may still write, and a save that would
 * clobber their work stops on its own.
 */
export function sessionWarning(holderName: string | null): string {
  const who = holderName ?? 'An Employee'
  return `${who} has a Session running in this worktree. If they write this file while you are editing it, your save will stop and show you both versions.`
}

/**
 * The same warning for the same hazard, one step further on: the Changes tab commits where the
 * editor only saves, so the sentence after the first says what committing costs instead of what a
 * save does. One warning per hazard — never both at once (T160).
 */
export function commitWarning(holderName: string | null): string {
  const who = holderName ?? 'An Employee'
  return `${who} has a Session running here. Committing now races what they are writing.`
}
