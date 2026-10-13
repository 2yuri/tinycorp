import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_RUNG, isRepoRung, mayPush, type RepoRung, rungRefusal } from '../../../shared/repos/repo'

/**
 * What the Company's repos allow TinyCorp to do to them (decision 61), read from the database at
 * every question so a rung changed mid-flight takes effect on the next push or merge. A repo that
 * was removed from the Company allows nothing new by itself: it is not here to refuse, and the
 * flows already say "removed repo" where it mattered.
 */

interface RungRow {
  name: string
  rung: string
}

function rowOf(db: DatabaseSync, repoId: string): RungRow | undefined {
  return db.prepare('SELECT name, rung FROM repo WHERE id = ?').get(repoId) as RungRow | undefined
}

/** The repo's rung, `merge` when the repo is unknown or its column holds something else. */
export function rungOf(db: DatabaseSync, repoId: string): RepoRung {
  const row = rowOf(db, repoId)
  return row && isRepoRung(row.rung) ? row.rung : DEFAULT_RUNG
}

/** Whether TinyCorp may push a branch and open a PR in the repo. */
export function repoMayPush(db: DatabaseSync, repoId: string): boolean {
  return mayPush(rungOf(db, repoId))
}

/** Why the repo refuses a push, naming it and its rung, or null when it allows one. */
export function pushRefusal(db: DatabaseSync, repoId: string): string | null {
  const row = rowOf(db, repoId)
  if (!row) return null
  return rungRefusal(row.name, rungOf(db, repoId), 'push')
}

/**
 * Why the first of these repos refuses a merge, naming it and its rung, or null when every one of
 * them allows it. No autonomy level, Autonomous included, gets past this.
 */
export function mergeRefusal(db: DatabaseSync, repoIds: readonly string[]): string | null {
  for (const repoId of repoIds) {
    const row = rowOf(db, repoId)
    if (!row) continue
    const refusal = rungRefusal(row.name, rungOf(db, repoId), 'merge')
    if (refusal) return refusal
  }
  return null
}

/**
 * Why the repos of `ticketId` refuse a merge, or null when they allow it: the repos it has a
 * worktree or a PR in, else the repos it was created for.
 */
export function ticketMergeRefusal(db: DatabaseSync, ticketId: number): string | null {
  const rows = db
    .prepare(
      `SELECT repo_id FROM worktree WHERE ticket_id = ?
         UNION SELECT repo_id FROM pull_request WHERE ticket_id = ?`,
    )
    .all(ticketId, ticketId) as { repo_id: string }[]
  const repoIds = rows.map((row) => row.repo_id)
  return mergeRefusal(db, repoIds.length > 0 ? repoIds : ticketRepos(db, ticketId))
}

function ticketRepos(db: DatabaseSync, ticketId: number): string[] {
  const row = db.prepare('SELECT repos FROM ticket WHERE id = ?').get(ticketId) as { repos: string } | undefined
  if (!row) return []
  try {
    const parsed: unknown = JSON.parse(row.repos)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
