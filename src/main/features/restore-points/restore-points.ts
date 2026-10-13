import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Column } from '../../../shared/domain/board'
import {
  RETENTION_DAYS,
  type RestoreLoss,
  type RestorePoint,
  type RestorePointReason,
} from '../../../shared/restore-points'
import type { Migration } from '../../core'
import { ticketCodeIn } from '../../core'
import type { CapturedWork, RestoreGit } from './restore-points-git'

/** The folder under the Company folder that holds every restore point's uncommitted work. */
export const RESTORE_POINTS_FOLDER = 'restore-points'

export { RETENTION_DAYS }

/** The restore-point migration step, appended to the engine's migrations. */
export const RESTORE_POINTS_MIGRATION: Migration = {
  name: 'restore-points-per-worktree',
  sql: `
  CREATE TABLE restore_point (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    repo_id TEXT NOT NULL,
    employee_id TEXT,
    reason TEXT NOT NULL,
    note TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    branch TEXT NOT NULL,
    index_patch TEXT,
    tree_patch TEXT,
    untracked TEXT,
    taken_at TEXT NOT NULL
  );
  CREATE INDEX restore_point_ticket ON restore_point (ticket_id);
`,
}

/** A ticket's restore points, as the ticket's drawer reads them. */
export interface RestorePoints {
  /** A ticket's restore points, newest first. */
  of(ticketId: number): RestorePoint[]
  /** What going back to `id` would throw away, for the confirmation. */
  losses(id: string): RestoreLoss
  /**
   * Goes back to a point: stops whoever is working on the ticket first, then puts that worktree's
   * tree and index back. Takes a point of what is there now, so going back is itself undoable.
   */
  goBack(id: string): RestorePoint
}

/** The Company's side: the moments that record a point, and the sweep that bounds them. */
export interface CompanyRestorePoints extends RestorePoints {
  /** Records the point an Employee starts a ticket's worktree from, by the worktree's path. */
  worktreeReady(ticketId: number, path: string): void
  /** Records a point for every commit the Employee has made since its last one. */
  noticedWork(employeeId: string): void
  /**
   * Records a point before the boss throws uncommitted work away from the Changes tab (T160), so
   * the one action that destroys work is one a restore point can undo. Null when this worktree is
   * not one the Company keeps points for.
   */
  beforeDiscard(input: { ticketId: number; path: string; note: string }): RestorePoint | null
  /**
   * Records a point of a sub-session's own worktree before the app removes it (T163): the parent
   * stopped or the ticket closed, and whatever it left uncommitted would otherwise be lost. The
   * worktree is not one of the ticket's own, so the point is kept under the ticket and the repo.
   */
  beforeRemovingSubSession(input: { ticketId: number; repoId: string; path: string; note: string }): RestorePoint | null
  /** Drops every point past the retention or belonging to a ticket that is done. */
  sweep(): void
  /** Drops every point of a ticket the boss is deleting, before its row goes (T275). */
  forgetTicket(ticketId: number): void
}

export interface RestorePointsOptions {
  db: DatabaseSync
  /** The Company folder; captured work is kept under it, never in a repo (decision 45). */
  folder: string
  /** Without one, nothing is recorded: a Company with no git service has no worktrees either. */
  git?: RestoreGit
  /** Stops the Employee's Session, before any worktree is touched. */
  stopSession(employeeId: string): void
  /** The name of an Employee, for what the confirmation says will stop. */
  nameOf(employeeId: string): string
  onChange(): void
  log(line: string): void
  /** How long a point is kept, in days. */
  retentionDays?: number
  now?(): Date
}

interface PointRow {
  id: string
  ticket_id: number
  repo_id: string
  employee_id: string | null
  reason: RestorePointReason
  note: string
  commit_sha: string
  branch: string
  index_patch: string | null
  tree_patch: string | null
  untracked: string | null
  taken_at: string
}

interface WorktreeRow {
  ticket_id: number
  repo_id: string
  path: string
}

interface TicketRow {
  id: number
  title: string
  column_id: Column
  assignee_id: string | null
}

export function createRestorePoints({
  db,
  folder,
  git,
  stopSession,
  nameOf,
  onChange,
  log,
  retentionDays = RETENTION_DAYS,
  now = () => new Date(),
}: RestorePointsOptions): CompanyRestorePoints {
  const store = join(folder, RESTORE_POINTS_FOLDER)

  function toPoint(row: PointRow): RestorePoint {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      repoId: row.repo_id,
      employeeId: row.employee_id,
      reason: row.reason,
      note: row.note,
      commit: row.commit_sha,
      branch: row.branch,
      hadUncommitted: row.index_patch !== null || row.tree_patch !== null || row.untracked !== null,
      takenAt: row.taken_at,
    }
  }

  function workOf(row: PointRow): CapturedWork {
    return { indexPatch: row.index_patch, treePatch: row.tree_patch, untracked: row.untracked }
  }

  function row(id: string): PointRow | undefined {
    return db.prepare('SELECT * FROM restore_point WHERE id = ?').get(id) as PointRow | undefined
  }

  function ticket(id: number): TicketRow | undefined {
    return db.prepare('SELECT id, title, column_id, assignee_id FROM ticket WHERE id = ?').get(id) as
      | TicketRow
      | undefined
  }

  function worktree(ticketId: number, repoId: string): WorktreeRow | undefined {
    return db
      .prepare('SELECT ticket_id, repo_id, path FROM worktree WHERE ticket_id = ? AND repo_id = ?')
      .get(ticketId, repoId) as WorktreeRow | undefined
  }

  function worktreeAt(ticketId: number, path: string): WorktreeRow | undefined {
    return db
      .prepare('SELECT ticket_id, repo_id, path FROM worktree WHERE ticket_id = ? AND path = ?')
      .get(ticketId, path) as WorktreeRow | undefined
  }

  /** The newest point of one worktree, or undefined when it has none. */
  function newest(ticketId: number, repoId: string): PointRow | undefined {
    return db
      .prepare('SELECT * FROM restore_point WHERE ticket_id = ? AND repo_id = ? ORDER BY taken_at DESC, rowid DESC')
      .get(ticketId, repoId) as PointRow | undefined
  }

  /** Records one point of a worktree as it is now, or null when there is nothing to read. */
  function take(input: {
    ticketId: number
    repoId: string
    path: string
    reason: RestorePointReason
    /** What it says the Employee was doing; the worktree's own commit subject when left out. */
    note?: string
  }): RestorePoint | null {
    if (!git) return null
    const at = git.state(input.path)
    if (!at) return null
    const id = randomUUID()
    let work: CapturedWork = { indexPatch: null, treePatch: null, untracked: null }
    try {
      work = git.capture({ path: input.path, folder: store, id })
    } catch (error) {
      log(`Could not keep the uncommitted work of ${ticketCodeIn(db, input.ticketId)}: ${String(error)}`)
    }
    db.prepare(
      `INSERT INTO restore_point
         (id, ticket_id, repo_id, employee_id, reason, note, commit_sha, branch,
          index_patch, tree_patch, untracked, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ticketId,
      input.repoId,
      ticket(input.ticketId)?.assignee_id ?? null,
      input.reason,
      input.note ?? at.subject,
      at.commit,
      at.branch || '',
      work.indexPatch,
      work.treePatch,
      work.untracked,
      now().toISOString(),
    )
    onChange()
    return toPoint(row(id)!)
  }

  function drop(rows: PointRow[]): void {
    if (rows.length === 0) return
    const forget = db.prepare('DELETE FROM restore_point WHERE id = ?')
    for (const point of rows) {
      try {
        git?.forget({ folder: store, work: workOf(point) })
      } catch (error) {
        log(`Could not drop the restore point ${point.id}: ${String(error)}`)
      }
      forget.run(point.id)
    }
    onChange()
  }

  return {
    of(ticketId) {
      const rows = db
        .prepare('SELECT * FROM restore_point WHERE ticket_id = ? ORDER BY taken_at DESC, rowid DESC')
        .all(ticketId) as unknown as PointRow[]
      return rows.map(toPoint)
    },

    losses(id) {
      const point = row(id)
      if (!point) throw new Error('That restore point is gone')
      const found = worktree(point.ticket_id, point.repo_id)
      const holder = ticket(point.ticket_id)?.assignee_id ?? null
      const state = found && git ? git.state(found.path) : null
      return {
        commits: found && git ? git.commitsSince(found.path, point.commit_sha) : [],
        uncommitted: state?.dirty ?? false,
        stops: holder ? { employeeId: holder, name: nameOf(holder) } : null,
      }
    },

    goBack(id) {
      const point = row(id)
      if (!point) throw new Error('That restore point is gone')
      if (!git) throw new Error('There is no git service to go back with')
      if (point.reason === 'sub-session') {
        // Its worktree is gone; the ticket's own is another branch, and must not be rewound to it.
        throw new Error(
          'That point is of a sub-session’s own worktree, which was removed, so there is nothing to go back in; ' +
            'nothing was changed',
        )
      }
      const found = worktree(point.ticket_id, point.repo_id)
      if (!found) throw new Error(`${ticketCodeIn(db, point.ticket_id)} no longer has that worktree`)
      const at = git.state(found.path)
      if (!at) throw new Error(`${found.path} is no longer a worktree to go back in`)
      if (point.branch && at.branch && at.branch !== point.branch) {
        throw new Error(`${found.path} is on ${at.branch} now, not ${point.branch}; nothing was changed`)
      }
      // Whoever was working stops first, so nothing writes into the worktree while it is put back.
      const holder = ticket(point.ticket_id)?.assignee_id ?? null
      if (holder) stopSession(holder)
      take({ ticketId: point.ticket_id, repoId: point.repo_id, path: found.path, reason: 'going-back' })
      git.restore({ path: found.path, folder: store, id: point.id, commit: point.commit_sha, work: workOf(point) })
      onChange()
      return toPoint(point)
    },

    beforeDiscard({ ticketId, path, note }) {
      const found = worktreeAt(ticketId, path)
      if (!found) return null
      return take({ ticketId, repoId: found.repo_id, path: found.path, reason: 'discard', note })
    },

    beforeRemovingSubSession({ ticketId, repoId, path, note }) {
      if (!ticket(ticketId)) return null
      return take({ ticketId, repoId, path, reason: 'sub-session', note })
    },

    worktreeReady(ticketId, path) {
      const found = worktreeAt(ticketId, path)
      const held = ticket(ticketId)
      if (!found || !held || newest(ticketId, found.repo_id)) return
      take({ ticketId, repoId: found.repo_id, path: found.path, reason: 'start', note: held.title })
    },

    noticedWork(employeeId) {
      if (!git) return
      const rows = db
        .prepare(
          `SELECT w.ticket_id, w.repo_id, w.path FROM worktree w
             JOIN ticket t ON t.id = w.ticket_id
            WHERE t.assignee_id = ? AND t.column_id <> 'done'`,
        )
        .all(employeeId) as unknown as WorktreeRow[]
      for (const found of rows) {
        const last = newest(found.ticket_id, found.repo_id)
        if (!last) continue
        // The cheap question first: a hook arrives for every tool an Employee runs.
        if (git.commitAt(found.path) === last.commit_sha) continue
        const at = git.state(found.path)
        if (!at || at.commit === last.commit_sha) continue
        take({ ticketId: found.ticket_id, repoId: found.repo_id, path: found.path, reason: 'commit' })
      }
    },

    sweep() {
      const cutoff = new Date(now().getTime() - retentionDays * DAY_MS).toISOString()
      const rows = db
        .prepare(
          `SELECT p.* FROM restore_point p
             LEFT JOIN ticket t ON t.id = p.ticket_id
            WHERE p.taken_at < ? OR t.column_id = 'done' OR t.id IS NULL`,
        )
        .all(cutoff) as unknown as PointRow[]
      drop(rows)
    },

    forgetTicket(ticketId) {
      drop(db.prepare('SELECT * FROM restore_point WHERE ticket_id = ?').all(ticketId) as unknown as PointRow[])
    },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
