import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES, type PermissionMode } from '../../../shared/domain/staff'
import type { Migration } from '../../core'

/**
 * The Company-wide defaults a hire takes when nobody names one (T164). Today that is the
 * permission mode, and the table is named for the whole idea rather than the one column, so the
 * next default is a column here and not a fourth settings table.
 *
 * A Company that existed before this migration has no row, and reads {@link DEFAULT_PERMISSION_MODE}:
 * what every Employee already ran with.
 */
export const STAFF_DEFAULTS_MIGRATION: Migration = {
  name: 'staff-company-defaults',
  sql: `
  CREATE TABLE staff_default (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    permission_mode TEXT NOT NULL
  );
`,
}

/** The permission mode this Company hands a new Employee. */
export function defaultPermissionMode(db: DatabaseSync): PermissionMode {
  const row = db.prepare('SELECT permission_mode FROM staff_default WHERE id = 1').get() as
    | { permission_mode: string }
    | undefined
  const stored = row?.permission_mode
  // A value the app no longer knows is not a reason to refuse every hire: fall back to the default.
  return PERMISSION_MODES.includes(stored as PermissionMode) ? (stored as PermissionMode) : DEFAULT_PERMISSION_MODE
}

/** Sets it. Employees already on staff keep the mode they have; this is only what the next one starts with. */
export function setDefaultPermissionMode(db: DatabaseSync, mode: PermissionMode): PermissionMode {
  if (!PERMISSION_MODES.includes(mode)) throw new Error(`Unknown permission mode: ${String(mode)}`)
  db.prepare(
    `INSERT INTO staff_default (id, permission_mode) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET permission_mode = excluded.permission_mode`,
  ).run(mode)
  return mode
}
