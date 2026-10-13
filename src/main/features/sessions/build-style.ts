import type { DatabaseSync } from 'node:sqlite'
import { type BuildStyle, DEFAULT_BUILD_STYLE, isBuildStyle } from '../../../shared/build-style'
import type { Migration } from '../../core'

/**
 * How Employees build, per Company (T194). One row, like the colleague voice and the notes budget:
 * it is one Company-wide choice, because it is how that Company's code comes out and not a habit
 * of one Employee.
 *
 * A Company made before this reads {@link DEFAULT_BUILD_STYLE}, which is `standard` — the add-on
 * is off until the boss turns it on, and turning it off again removes the section at the next
 * Session start.
 */
export const BUILD_STYLE_MIGRATION: Migration = {
  name: 'company-build-style',
  sql: `
  CREATE TABLE build_style_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    style TEXT NOT NULL
  );
`,
}

/** What a Company reads and writes about the way its Employees build. */
export interface BuildStyleSettings {
  buildStyle(): BuildStyle
  setBuildStyle(style: BuildStyle): BuildStyle
}

export function createBuildStyleSettings(db: DatabaseSync, onChange: () => void = () => {}): BuildStyleSettings {
  return {
    buildStyle() {
      const row = db.prepare('SELECT style FROM build_style_setting WHERE id = 1').get() as
        | { style: string }
        | undefined
      // A value this build does not know is not a reason to read nothing: fall back to the default.
      return isBuildStyle(row?.style) ? row.style : DEFAULT_BUILD_STYLE
    },

    setBuildStyle(style) {
      if (!isBuildStyle(style)) throw new Error(`Unknown build style: ${String(style)}`)
      db.prepare(
        `INSERT INTO build_style_setting (id, style) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET style = excluded.style`,
      ).run(style)
      onChange()
      return style
    },
  }
}
