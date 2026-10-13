import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { isInsideFolder } from '../../core'
import { createGitRunner, type GitRunner } from '../../platform'

/**
 * Where a Company folder moves when the boss picks `picked` (decision 45): the picked folder itself
 * when it is empty or missing, otherwise a sub-folder named like the Company folder. Throws when that
 * is taken or lies inside the Company folder.
 */
export function companyMoveTarget(from: string, picked: string): string {
  if (!isAbsolute(picked)) throw new Error(`A folder to move to must be absolute: ${picked}`)
  const source = resolve(from)
  const chosen = resolve(picked)
  if (isInsideFolder(chosen, source)) throw new Error(`A Company cannot move inside its own folder: ${chosen}`)
  if (!existsSync(chosen)) return chosen
  if (!statSync(chosen).isDirectory()) throw new Error(`${chosen} is not a folder`)
  if (readdirSync(chosen).length === 0) return chosen
  const target = join(chosen, basename(source))
  if (existsSync(target)) throw new Error(`${target} already exists; choose another folder`)
  return target
}

/** Moves the folder `from` to `to`, copying across disks when a rename cannot. */
export function moveFolder(from: string, to: string): void {
  if (!statSync(from, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${from} is not a folder`)
  if (existsSync(to)) rmdirSync(to) // only ever an empty folder, as `companyMoveTarget` picks
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    cpSync(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true })
    rmSync(from, { recursive: true, force: true })
  }
}

/** Points the repo and worktree paths that lived inside the moved folder at their new place. */
export function rewriteMovedPaths(db: DatabaseSync, from: string, to: string): void {
  for (const table of ['repo', 'worktree'] as const) {
    let rows: { rowid: number; path: string }[]
    try {
      rows = db.prepare(`SELECT rowid, path FROM ${table}`).all() as typeof rows
    } catch {
      continue
    }
    const update = db.prepare(`UPDATE ${table} SET path = ? WHERE rowid = ?`)
    for (const { rowid, path } of rows) {
      if (isInsideFolder(path, from)) update.run(join(to, relative(resolve(from), resolve(path))), rowid)
    }
  }
}

/**
 * Relinks each repo with its ticket worktrees after a move (`git worktree repair`), so git finds
 * them at their new paths. Best effort: a repo or worktree that is gone is skipped and logged.
 */
export function repairWorktrees(
  db: DatabaseSync,
  log: (line: string) => void,
  git: GitRunner = createGitRunner(),
): void {
  let rows: { repo: string; worktree: string }[]
  try {
    rows = db
      .prepare('SELECT r.path AS repo, w.path AS worktree FROM worktree w JOIN repo r ON r.id = w.repo_id')
      .all() as typeof rows
  } catch {
    return
  }
  const byRepo = new Map<string, string[]>()
  for (const { repo, worktree } of rows) {
    if (existsSync(repo) && existsSync(worktree)) byRepo.set(repo, [...(byRepo.get(repo) ?? []), worktree])
  }
  for (const [repo, worktrees] of byRepo) {
    try {
      git.text(repo, ['worktree', 'repair', ...worktrees])
    } catch (error) {
      log(`Move: could not repair the worktrees of ${repo}: ${(error as Error).message}`)
    }
  }
}
