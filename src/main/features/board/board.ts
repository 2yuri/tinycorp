import type { DatabaseSync } from 'node:sqlite'
import {
  type BoardSnapshot,
  COLUMN_TITLES,
  COLUMNS,
  type Column,
  type Epic,
  type EpicChanges,
  type NewEpic,
  type NewSubtask,
  type NewTarget,
  type NewTicket,
  type Subtask,
  type SubtaskChanges,
  type Target,
  type TargetChanges,
  type Ticket,
  type TicketChanges,
} from '../../../shared/domain/board'
import { defaultEpicColor, type EpicColor, type Priority } from '../../../shared/ticket-extras'
import { loopRefusal, waitingRefusal, wouldLoop } from '../../../shared/ticket-links'
import { type Migration, ticketCodeIn } from '../../core'
import { recordColumnEntry } from './column-entries'
import { optionalBaseBranch, requireEpicColor, requireLabels, requirePriority } from './ticket-extras'
import { blockersOf, openBlockersOf, waitersOn } from './ticket-links'

/**
 * The kanban board of one Company: Target → Epic → Ticket → Subtask.
 * Every method validates its input, since callers include the renderer and, later, Employees.
 */
export interface Board {
  snapshot(): BoardSnapshot
  createTarget(input: NewTarget): Target
  updateTarget(id: number, changes: TargetChanges): Target
  createEpic(input: NewEpic): Epic
  updateEpic(id: number, changes: EpicChanges): Epic
  createTicket(input: NewTicket): Ticket
  updateTicket(id: number, changes: TicketChanges): Ticket
  /**
   * Moves a ticket to `index` in `column` (the bottom when omitted). Over-limit moves are allowed
   * and shown; starting a ticket that waits on another is refused, naming what it waits on.
   */
  moveTicket(id: number, column: Column, index?: number): Ticket
  /** Makes `id` wait on `blockedById` (T266). A loop, however long, is refused. */
  addBlocker(id: number, blockedById: number): Ticket
  removeBlocker(id: number, blockedById: number): Ticket
  createSubtask(input: NewSubtask): Subtask
  updateSubtask(id: number, changes: SubtaskChanges): Subtask
  deleteSubtask(id: number): void
  /** A positive whole number, or null for no limit. */
  setWipLimit(column: Column, limit: number | null): void
}

/** A Target's due day (T151): the chat's target card says when it is due. */
export const TARGET_DUE_MIGRATION: Migration = {
  name: 'board-target-due',
  sql: `ALTER TABLE target ADD COLUMN due_at TEXT`,
}

/**
 * Testing, between Review and Done (T174). The columns themselves are `COLUMNS` in
 * `shared/board.ts`, so the only row a column owns is the one that holds its WIP limit: this gives
 * Testing its own, empty like every other column's, and nothing that existed before it moves.
 */
export const TESTING_COLUMN_MIGRATION: Migration = {
  name: 'board-testing-column',
  sql: `
  INSERT OR IGNORE INTO board_column (id, wip_limit) VALUES ('testing', NULL);
`,
}

/** The board's migration step, appended to the engine's migrations. */
export const BOARD_MIGRATION: Migration = {
  name: 'board-tables',
  sql: `
  CREATE TABLE target (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE epic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER REFERENCES target(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE ticket (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epic_id INTEGER REFERENCES epic(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    column_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    assignee_id TEXT,
    repos TEXT NOT NULL DEFAULT '[]',
    blocked INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE subtask (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    repo TEXT,
    position INTEGER NOT NULL
  );
  CREATE TABLE board_column (
    id TEXT PRIMARY KEY,
    wip_limit INTEGER
  );
`,
}

interface TicketRow {
  id: number
  epic_id: number | null
  title: string
  description: string
  column_id: Column
  assignee_id: string | null
  repos: string
  blocked: number
  blocked_reason: string
  priority: Priority
  labels: string
  base_branch: string | null
}

interface SubtaskRow {
  id: number
  ticket_id: number
  title: string
  done: number
  repo: string | null
}

export function createBoard(db: DatabaseSync, notify: () => void): Board {
  function edit<T>(action: () => T): T {
    db.exec('BEGIN')
    let result: T
    try {
      result = action()
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    notify()
    return result
  }

  function target(id: number): Target {
    const row = db.prepare('SELECT id, title, description, due_at FROM target WHERE id = ?').get(id) as
      | (Omit<Target, 'dueAt'> & { due_at: string | null })
      | undefined
    if (!row) throw new Error(`There is no target ${id}`)
    return { id: row.id, title: row.title, description: row.description, dueAt: row.due_at }
  }

  function epic(id: number): Epic {
    const row = db.prepare('SELECT id, target_id, title, description, color FROM epic WHERE id = ?').get(id) as
      | { id: number; target_id: number | null; title: string; description: string; color: EpicColor }
      | undefined
    if (!row) throw new Error(`There is no epic ${id}`)
    return {
      id: row.id,
      targetId: row.target_id,
      title: row.title,
      description: row.description,
      color: row.color,
    }
  }

  function subtasksOf(ticketId: number): Subtask[] {
    const rows = db
      .prepare('SELECT * FROM subtask WHERE ticket_id = ? ORDER BY position, id')
      .all(ticketId) as unknown as SubtaskRow[]
    return rows.map(toSubtask)
  }

  function toTicket(row: TicketRow): Ticket {
    return {
      id: row.id,
      epicId: row.epic_id,
      title: row.title,
      description: row.description,
      column: row.column_id,
      assigneeId: row.assignee_id,
      repos: JSON.parse(row.repos) as string[],
      blocked: row.blocked === 1,
      blockedReason: row.blocked_reason,
      blockedBy: blockersOf(db, row.id),
      blocks: waitersOn(db, row.id),
      subtasks: subtasksOf(row.id),
      priority: row.priority,
      labels: JSON.parse(row.labels) as string[],
      baseBranch: row.base_branch,
    }
  }

  function ticket(id: number): Ticket {
    const row = db.prepare('SELECT * FROM ticket WHERE id = ?').get(id) as TicketRow | undefined
    if (!row) throw new Error(`There is no ticket #${id}`)
    return toTicket(row)
  }

  function subtask(id: number): Subtask {
    const row = db.prepare('SELECT * FROM subtask WHERE id = ?').get(id) as SubtaskRow | undefined
    if (!row) throw new Error(`There is no subtask ${id}`)
    return toSubtask(row)
  }

  function ticketIdsIn(column: Column): number[] {
    const rows = db.prepare('SELECT id FROM ticket WHERE column_id = ? ORDER BY position, id').all(column) as {
      id: number
    }[]
    return rows.map((r) => r.id)
  }

  function placeInColumn(id: number, column: Column, index?: number) {
    const ids = ticketIdsIn(column).filter((other) => other !== id)
    const at = index === undefined ? ids.length : Math.max(0, Math.min(index, ids.length))
    ids.splice(at, 0, id)
    const update = db.prepare('UPDATE ticket SET column_id = ?, position = ? WHERE id = ?')
    ids.forEach((ticketId, position) => {
      update.run(column, position, ticketId)
    })
  }

  function requireRepos(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((r) => typeof r === 'string')) {
      throw new Error('Repos must be a list of repo ids')
    }
    const known = db.prepare('SELECT 1 FROM repo WHERE id = ?')
    const unknown = value.find((id) => !known.get(id))
    if (unknown !== undefined) throw new Error(`The Company has no repo ${unknown}`)
    return [...new Set(value as string[])]
  }

  /** The subtask rule: another person or another repo means another ticket. */
  function checkSubtaskFits(parent: Ticket, assigneeId: string | null | undefined, repo: string | null) {
    if (assigneeId != null && assigneeId !== parent.assigneeId) {
      throw new Error(`A subtask cannot have a different assignee than its ticket #${parent.id}; make it a ticket`)
    }
    if (repo !== null && !parent.repos.includes(repo)) {
      throw new Error(`A subtask cannot be in a different repo than its ticket #${parent.id}; make it a ticket`)
    }
  }

  return {
    snapshot() {
      const limits = new Map(
        (
          db.prepare('SELECT id, wip_limit FROM board_column').all() as {
            id: string
            wip_limit: number | null
          }[]
        ).map((r) => [r.id, r.wip_limit]),
      )
      const ticketRows = db
        .prepare(
          `SELECT * FROM ticket ORDER BY CASE column_id ${COLUMNS.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ')} END, position, id`,
        )
        .all() as unknown as TicketRow[]
      const tickets = ticketRows.map(toTicket)
      const targets = (db.prepare('SELECT id FROM target ORDER BY id').all() as { id: number }[]).map((r) =>
        target(r.id),
      )
      const epics = (db.prepare('SELECT id FROM epic ORDER BY id').all() as { id: number }[]).map((r) => epic(r.id))
      return {
        columns: COLUMNS.map((id) => {
          const wipLimit = limits.get(id) ?? null
          const count = tickets.filter((t) => t.column === id).length
          return {
            id,
            title: COLUMN_TITLES[id],
            wipLimit,
            count,
            overLimit: wipLimit !== null && count > wipLimit,
          }
        }),
        targets,
        epics,
        tickets,
      }
    },

    createTarget(input) {
      const title = requireTitle(input?.title)
      const description = optionalText(input.description, 'description') ?? ''
      const dueAt = optionalDay(input.dueAt) ?? null
      return edit(() => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO target (title, description, due_at) VALUES (?, ?, ?)')
          .run(title, description, dueAt)
        return target(Number(lastInsertRowid))
      })
    },

    updateTarget(id, changes) {
      const current = target(requireId(id, 'target'))
      const title = changes.title === undefined ? current.title : requireTitle(changes.title)
      const description = optionalText(changes.description, 'description') ?? current.description
      const dueAt = changes.dueAt === undefined ? current.dueAt : (optionalDay(changes.dueAt) ?? null)
      return edit(() => {
        db.prepare('UPDATE target SET title = ?, description = ?, due_at = ? WHERE id = ?').run(
          title,
          description,
          dueAt,
          id,
        )
        return target(id)
      })
    },

    createEpic(input) {
      const title = requireTitle(input?.title)
      const description = optionalText(input.description, 'description') ?? ''
      const targetId = optionalId(input.targetId, 'target')
      if (targetId !== null) target(targetId)
      const color = input.color === undefined ? null : requireEpicColor(input.color)
      return edit(() => {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM epic').get() as { n: number }
        const { lastInsertRowid } = db
          .prepare('INSERT INTO epic (target_id, title, description, color) VALUES (?, ?, ?, ?)')
          .run(targetId, title, description, color ?? defaultEpicColor(n))
        return epic(Number(lastInsertRowid))
      })
    },

    updateEpic(id, changes) {
      const current = epic(requireId(id, 'epic'))
      const title = changes.title === undefined ? current.title : requireTitle(changes.title)
      const description = optionalText(changes.description, 'description') ?? current.description
      const targetId = changes.targetId === undefined ? current.targetId : optionalId(changes.targetId, 'target')
      if (targetId !== null) target(targetId)
      const color = changes.color === undefined ? current.color : requireEpicColor(changes.color)
      return edit(() => {
        db.prepare('UPDATE epic SET target_id = ?, title = ?, description = ?, color = ? WHERE id = ?').run(
          targetId,
          title,
          description,
          color,
          id,
        )
        return epic(id)
      })
    },

    createTicket(input) {
      const title = requireTitle(input?.title)
      const description = optionalText(input.description, 'description') ?? ''
      const epicId = optionalId(input.epicId, 'epic')
      if (epicId !== null) epic(epicId)
      // A new ticket starts in Planning (T171): it is planned in chat before it is Ready.
      const column = input.column === undefined ? 'planning' : requireColumn(input.column)
      const assigneeId = optionalText(input.assigneeId, 'assignee') ?? null
      const repos = input.repos === undefined ? [] : requireRepos(input.repos)
      const priority = input.priority === undefined ? 'normal' : requirePriority(input.priority)
      const labels = input.labels === undefined ? [] : requireLabels(input.labels)
      const baseBranch = optionalBaseBranch(input.baseBranch)
      return edit(() => {
        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO ticket (epic_id, title, description, column_id, position, assignee_id, repos,
               priority, labels, base_branch)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            epicId,
            title,
            description,
            column,
            ticketIdsIn(column).length,
            assigneeId,
            JSON.stringify(repos),
            priority,
            JSON.stringify(labels),
            baseBranch,
          )
        recordColumnEntry(db, Number(lastInsertRowid), column)
        return ticket(Number(lastInsertRowid))
      })
    },

    updateTicket(id, changes) {
      const current = ticket(requireId(id, 'ticket'))
      const title = changes.title === undefined ? current.title : requireTitle(changes.title)
      const description = optionalText(changes.description, 'description') ?? current.description
      const epicId = changes.epicId === undefined ? current.epicId : optionalId(changes.epicId, 'epic')
      if (epicId !== null) epic(epicId)
      const assigneeId =
        changes.assigneeId === undefined ? current.assigneeId : (optionalText(changes.assigneeId, 'assignee') ?? null)
      const repos = changes.repos === undefined ? current.repos : requireRepos(changes.repos)
      const orphaned = current.subtasks.find((s) => s.repo !== null && !repos.includes(s.repo))
      if (orphaned) {
        throw new Error(`Repo ${orphaned.repo} is still used by subtask "${orphaned.title}"`)
      }
      if (changes.blocked !== undefined && typeof changes.blocked !== 'boolean') {
        throw new Error('Blocked must be true or false')
      }
      const priority = changes.priority === undefined ? current.priority : requirePriority(changes.priority)
      const labels = changes.labels === undefined ? current.labels : requireLabels(changes.labels)
      const baseBranch = changes.baseBranch === undefined ? current.baseBranch : optionalBaseBranch(changes.baseBranch)
      const blocked = changes.blocked ?? current.blocked
      const blockedReason = blocked
        ? (optionalText(changes.blockedReason, 'blocked reason') ?? current.blockedReason)
        : ''
      return edit(() => {
        db.prepare(
          `UPDATE ticket SET epic_id = ?, title = ?, description = ?, assignee_id = ?, repos = ?,
             blocked = ?, blocked_reason = ?, priority = ?, labels = ?, base_branch = ? WHERE id = ?`,
        ).run(
          epicId,
          title,
          description,
          assigneeId,
          JSON.stringify(repos),
          blocked ? 1 : 0,
          blockedReason,
          priority,
          JSON.stringify(labels),
          baseBranch,
          id,
        )
        return ticket(id)
      })
    },

    moveTicket(id, column, index) {
      const current = ticket(requireId(id, 'ticket'))
      requireColumn(column)
      if (index !== undefined && !(Number.isInteger(index) && index >= 0)) {
        throw new Error('A position must be a whole number from 0')
      }
      // Every way work starts — a claim, a drag, the drawer, a tool — is a move into Doing from
      // before it, so this is the one place a ticket that waits is refused. A ticket sent back
      // from Review or Testing has already started, and is not refused here.
      if (column === 'doing' && COLUMNS.indexOf(current.column) < COLUMNS.indexOf('doing')) {
        const open = openBlockersOf(db, id)
        if (open.length > 0) {
          throw new Error(
            waitingRefusal(
              ticketCodeIn(db, id),
              open.map((blocker) => ticketCodeIn(db, blocker)),
            ),
          )
        }
      }
      return edit(() => {
        placeInColumn(id, column, index)
        if (current.column !== column) recordColumnEntry(db, id, column)
        return ticket(id)
      })
    },

    addBlocker(id, blockedById) {
      ticket(requireId(id, 'ticket'))
      ticket(requireId(blockedById, 'ticket'))
      if (id === blockedById) throw new Error(`${ticketCodeIn(db, id)} cannot wait on itself`)
      if (wouldLoop(id, blockedById, (other) => blockersOf(db, other))) {
        throw new Error(loopRefusal(ticketCodeIn(db, blockedById), ticketCodeIn(db, id)))
      }
      return edit(() => {
        db.prepare(
          'INSERT OR IGNORE INTO ticket_dependency (ticket_id, blocked_by_id, created_at) VALUES (?, ?, ?)',
        ).run(id, blockedById, new Date().toISOString())
        return ticket(id)
      })
    },

    removeBlocker(id, blockedById) {
      ticket(requireId(id, 'ticket'))
      requireId(blockedById, 'ticket')
      return edit(() => {
        db.prepare('DELETE FROM ticket_dependency WHERE ticket_id = ? AND blocked_by_id = ?').run(id, blockedById)
        return ticket(id)
      })
    },

    createSubtask(input) {
      const parent = ticket(requireId(input?.ticketId, 'ticket'))
      const title = requireTitle(input.title)
      const assigneeId = optionalText(input.assigneeId, 'assignee')
      const repo = optionalText(input.repo, 'repo') ?? null
      checkSubtaskFits(parent, assigneeId, repo)
      return edit(() => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO subtask (ticket_id, title, repo, position) VALUES (?, ?, ?, ?)')
          .run(parent.id, title, repo, parent.subtasks.length)
        return subtask(Number(lastInsertRowid))
      })
    },

    updateSubtask(id, changes) {
      const current = subtask(requireId(id, 'subtask'))
      const title = changes.title === undefined ? current.title : requireTitle(changes.title)
      if (changes.done !== undefined && typeof changes.done !== 'boolean') {
        throw new Error('Done must be true or false')
      }
      const done = changes.done ?? current.done
      const repo = changes.repo === undefined ? current.repo : (optionalText(changes.repo, 'repo') ?? null)
      checkSubtaskFits(ticket(current.ticketId), optionalText(changes.assigneeId, 'assignee'), repo)
      return edit(() => {
        db.prepare('UPDATE subtask SET title = ?, done = ?, repo = ? WHERE id = ?').run(title, done ? 1 : 0, repo, id)
        return subtask(id)
      })
    },

    deleteSubtask(id) {
      subtask(requireId(id, 'subtask'))
      edit(() => db.prepare('DELETE FROM subtask WHERE id = ?').run(id))
    },

    setWipLimit(column, limit) {
      requireColumn(column)
      if (limit !== null && !(Number.isInteger(limit) && limit > 0)) {
        throw new Error('A WIP limit must be a positive whole number, or none')
      }
      edit(() =>
        db
          .prepare(
            'INSERT INTO board_column (id, wip_limit) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET wip_limit = excluded.wip_limit',
          )
          .run(column, limit),
      )
    },
  }
}

function toSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    title: row.title,
    done: row.done === 1,
    repo: row.repo,
  }
}

function requireTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new Error('A title is required')
  return title
}

function requireId(value: unknown, what: string): number {
  if (!Number.isInteger(value)) throw new Error(`There is no ${what} ${String(value)}`)
  return value as number
}

function optionalId(value: unknown, what: string): number | null {
  return value === undefined || value === null ? null : requireId(value, what)
}

/** Undefined stays undefined (no change); null and blank text become null. */
function optionalText(value: unknown, what: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`The ${what} must be text`)
  return what === 'description' || what === 'blocked reason' ? value : value.trim() || null
}

/** A calendar day, `2026-09-25`; undefined stays undefined (no change), null and blank clear it. */
function optionalDay(value: unknown): string | null | undefined {
  const text = optionalText(value, 'due day')
  if (text === undefined || text === null) return text
  const day = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text) {
    throw new Error(`The due day must be a date like 2026-09-25, not ${text}`)
  }
  return text
}

function requireColumn(value: unknown): Column {
  if (!COLUMNS.includes(value as Column)) throw new Error(`There is no column ${String(value)}`)
  return value as Column
}
