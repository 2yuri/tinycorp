import type { DatabaseSync } from 'node:sqlite'
import type { Migration } from '../../core'

/**
 * A ticket that waits on another (T266): one row per pair, the waiting ticket first. A ticket has
 * any number of blockers, and deleting either end takes the row with it.
 */
export const TICKET_LINKS_MIGRATION: Migration = {
  name: 'board-ticket-dependency',
  sql: `
  CREATE TABLE ticket_dependency (
    ticket_id INTEGER NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    blocked_by_id INTEGER NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, blocked_by_id)
  );
  CREATE INDEX ticket_dependency_by_blocker ON ticket_dependency (blocked_by_id);
`,
}

/** The tickets `ticketId` waits on, in the order they were added. */
export function blockersOf(db: DatabaseSync, ticketId: number): number[] {
  const rows = db
    .prepare('SELECT blocked_by_id AS id FROM ticket_dependency WHERE ticket_id = ? ORDER BY created_at, rowid')
    .all(ticketId) as { id: number }[]
  return rows.map((r) => r.id)
}

/** The tickets that wait on `ticketId`. */
export function waitersOn(db: DatabaseSync, ticketId: number): number[] {
  const rows = db
    .prepare('SELECT ticket_id AS id FROM ticket_dependency WHERE blocked_by_id = ? ORDER BY ticket_id')
    .all(ticketId) as { id: number }[]
  return rows.map((r) => r.id)
}

/** The blockers of `ticketId` that are not Done yet. */
export function openBlockersOf(db: DatabaseSync, ticketId: number): number[] {
  const rows = db
    .prepare(
      `SELECT d.blocked_by_id AS id FROM ticket_dependency d JOIN ticket t ON t.id = d.blocked_by_id
       WHERE d.ticket_id = ? AND t.column_id <> 'done' ORDER BY d.created_at, d.rowid`,
    )
    .all(ticketId) as { id: number }[]
  return rows.map((r) => r.id)
}
