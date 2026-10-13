import type { DatabaseSync } from 'node:sqlite'
import { type CavemanLevel, DEFAULT_CAVEMAN, isCavemanLevel } from '../../../shared/caveman'
import type { Migration } from '../../core'

/**
 * How Employees answer the boss, per Company (T261). One row, like the build style beside it: it is
 * one Company-wide choice, because it is how that Company talks to the one person reading, and not
 * a habit of one Employee.
 *
 * A Company made before this reads {@link DEFAULT_CAVEMAN}, which is `off` — the add-on is off
 * until the boss turns it on, and turning it off again removes the section at the next Session
 * start.
 */
export const CAVEMAN_MIGRATION: Migration = {
  name: 'company-caveman',
  sql: `
  CREATE TABLE caveman_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    level TEXT NOT NULL
  );
`,
}

/** What a Company reads and writes about the way its Employees answer the boss. */
export interface CavemanSettings {
  caveman(): CavemanLevel
  setCaveman(level: CavemanLevel): CavemanLevel
}

export function createCavemanSettings(db: DatabaseSync, onChange: () => void = () => {}): CavemanSettings {
  return {
    caveman() {
      const row = db.prepare('SELECT level FROM caveman_setting WHERE id = 1').get() as { level: string } | undefined
      // A value this build does not know is not a reason to read nothing: fall back to the default.
      return isCavemanLevel(row?.level) ? row.level : DEFAULT_CAVEMAN
    },

    setCaveman(level) {
      if (!isCavemanLevel(level)) throw new Error(`Unknown caveman level: ${String(level)}`)
      db.prepare(
        `INSERT INTO caveman_setting (id, level) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET level = excluded.level`,
      ).run(level)
      onChange()
      return level
    },
  }
}
