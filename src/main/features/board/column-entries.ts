import type { DatabaseSync } from 'node:sqlite'
import type { Column } from '../../../shared/domain/board'
import type { Migration } from '../../core'

/**
 * The column-entry migration step, appended to the engine's migrations: one row each time a ticket
 * enters a column. Tickets that exist already are recorded as entering their column now.
 */
export const COLUMN_ENTRIES_MIGRATION: Migration = {
  name: 'board-ticket-column-entries',
  sql: `
  CREATE TABLE ticket_column_entry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    column_id TEXT NOT NULL,
    entered_at TEXT NOT NULL
  );
  CREATE INDEX ticket_column_entry_by_ticket ON ticket_column_entry (ticket_id, id);
  INSERT INTO ticket_column_entry (ticket_id, column_id, entered_at)
    SELECT id, column_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM ticket;
`,
}

/** Records that `ticketId` entered `column` now. */
export function recordColumnEntry(db: DatabaseSync, ticketId: number, column: Column): void {
  db.prepare('INSERT INTO ticket_column_entry (ticket_id, column_id, entered_at) VALUES (?, ?, ?)').run(
    ticketId,
    column,
    new Date().toISOString(),
  )
}

/**
 * How long tickets stayed in `column`, averaged over the stays that ended (the ticket moved on),
 * in milliseconds; null when no stay has ended yet.
 */
export function averageStay(db: DatabaseSync, column: Column): { averageMs: number | null; stays: number } {
  const rows = db
    .prepare(
      `SELECT entry.entered_at AS entered, (
         SELECT next.entered_at FROM ticket_column_entry next
         WHERE next.ticket_id = entry.ticket_id AND next.id > entry.id
         ORDER BY next.id LIMIT 1
       ) AS left_at
       FROM ticket_column_entry entry
       WHERE entry.column_id = ?`,
    )
    .all(column) as { entered: string; left_at: string | null }[]
  const stays = rows.filter((r) => r.left_at !== null).map((r) => Date.parse(r.left_at!) - Date.parse(r.entered))
  if (stays.length === 0) return { averageMs: null, stays: 0 }
  return { averageMs: Math.round(stays.reduce((sum, ms) => sum + ms, 0) / stays.length), stays: stays.length }
}
