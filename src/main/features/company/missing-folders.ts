import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RecentCompanies } from '../../core'

/** Whether a path is on disk now; injected so the rules can be tested without a filesystem. */
export type PathExists = (path: string) => boolean

/**
 * How a Company's folder looks on disk (T57):
 * - `present`: it is there.
 * - `deleted`: it is gone, but the folder it lived in is still there — someone removed it.
 * - `unreachable`: its parent is gone too, which is what an unmounted drive looks like.
 */
export type FolderState = 'present' | 'deleted' | 'unreachable'

export function folderState(folder: string, exists: PathExists = existsSync): FolderState {
  const path = resolve(folder)
  if (exists(path)) return 'present'
  const parent = dirname(path)
  // A root that is its own parent (`/`, `C:\`) is never the reason a folder is gone.
  if (parent === path) return 'deleted'
  return exists(parent) ? 'deleted' : 'unreachable'
}

/**
 * Since when each Company's folder has been seen deleted, by Company id, kept across app starts.
 * The grace is measured against these marks, so a first sighting never forgets anything.
 */
export interface MissingMarks {
  read(): Record<string, string>
  write(marks: Record<string, string>): void
}

/** Marks in memory, for tests and for an app that has nowhere to keep them. */
export function inMemoryMissingMarks(seed: Record<string, string> = {}): MissingMarks {
  let marks = { ...seed }
  return {
    read: () => ({ ...marks }),
    write(next) {
      marks = { ...next }
    },
  }
}

/** How long a folder must have been deleted before its Company is dropped from recents. */
export const MISSING_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export interface PruneMissingOptions {
  recents: RecentCompanies
  marks: MissingMarks
  exists?: PathExists
  now?: () => Date
  /** Defaults to `MISSING_GRACE_MS`. */
  grace?: number
}

/**
 * Drops from recents every Company whose folder has been deleted for longer than the grace, and
 * records the first sighting of the others, so a later start knows how long it has been
 * (T57). Nothing is asked of the boss: the grace is what stands in for a confirmation.
 *
 * A folder on an unmounted drive is `unreachable`, never `deleted`, so its Company keeps its row
 * however long the drive stays away; only `Forget` removes that one. Returns the ids forgotten.
 */
export function pruneMissingCompanies({
  recents,
  marks,
  exists = existsSync,
  now = () => new Date(),
  grace = MISSING_GRACE_MS,
}: PruneMissingOptions): string[] {
  const seen = marks.read()
  const at = now()
  const next: Record<string, string> = {}
  const forgotten: string[] = []

  for (const company of recents.list()) {
    // The clock only runs while the folder is plainly deleted; anything else clears the mark.
    if (folderState(company.folder, exists) !== 'deleted') continue
    const since = seen[company.id] ?? at.toISOString()
    if (at.getTime() - new Date(since).getTime() >= grace) {
      recents.forget(company.id)
      forgotten.push(company.id)
    } else {
      next[company.id] = since
    }
  }

  const changed =
    Object.keys(next).length !== Object.keys(seen).length ||
    Object.entries(next).some(([id, since]) => seen[id] !== since)
  if (changed) marks.write(next)
  return forgotten
}
