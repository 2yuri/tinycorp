import { rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { COMPANY_DATABASE_FILES, COMPANY_MARKER_FOLDER } from '../../core'
import { WORKTREES_FOLDER } from '../code'
import { RESTORE_POINTS_FOLDER } from '../restore-points'

/**
 * What a Company keeps in its folder, and all `Delete company…` removes: the database with its
 * SQLite side files, the file naming a database this PC holds instead (T256), Employees' memory
 * files, ticket worktrees, attachments and restore points.
 */
export const COMPANY_DATA = [
  ...COMPANY_DATABASE_FILES,
  COMPANY_MARKER_FOLDER,
  'memory',
  WORKTREES_FOLDER,
  'attachments',
  RESTORE_POINTS_FOLDER,
] as const

/** The paths of a Company's connected repos. Never throws: a database without repos has none. */
export function connectedRepoPaths(db: DatabaseSync): string[] {
  try {
    return (db.prepare('SELECT path FROM repo').all() as { path: string }[]).map((r) => r.path)
  } catch {
    return []
  }
}

function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Throws, naming the repo, when a connected repo lives inside the Company's data, so a delete
 * would take it along. Call it before anything is forgotten or removed.
 */
export function assertDataHoldsNoRepo(folder: string, repoPaths: string[]): void {
  for (const data of COMPANY_DATA) {
    const target = join(resolve(folder), data)
    const repo = repoPaths.find((path) => isInside(resolve(path), target))
    if (repo) throw new Error(`${repo} is a connected repo inside ${target}; nothing was deleted`)
  }
}

/** Removes the Company's own data from `folder`; everything else in it stays. */
export function removeCompanyData(folder: string): void {
  // rmSync removes a symlink itself, never what it points to.
  for (const data of COMPANY_DATA) rmSync(join(resolve(folder), data), { recursive: true, force: true })
}
