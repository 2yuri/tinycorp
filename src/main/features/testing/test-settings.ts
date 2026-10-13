import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_TEST_MODE,
  isValidPort,
  type RepoTestChanges,
  type RepoTestSettings,
  strictestMode,
  TEST_MODES,
  type TestMode,
  type TestSettings,
} from '../../../shared/testing'
import type { Migration } from '../../core'

/**
 * Who tests before a merge (T174): one Company-wide mode, and the repos that differ from it.
 *
 * The per-repo rule lives on the repo row, beside its rung, because it is the same kind of thing —
 * what TinyCorp may do with this repo — and because removing a repo then takes its rule with it.
 * A Company that existed before this reads {@link DEFAULT_TEST_MODE}, which is `nobody`: exactly
 * what it did before Testing existed.
 */
export const TESTING_SETTINGS_MIGRATION: Migration = {
  name: 'testing-who-tests-and-per-repo-overrides',
  sql: `
  CREATE TABLE testing_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL
  );
  ALTER TABLE repo ADD COLUMN test_mode TEXT;
  ALTER TABLE repo ADD COLUMN run_command TEXT NOT NULL DEFAULT '';
  ALTER TABLE repo ADD COLUMN test_port INTEGER;
`,
}

/** What a Company reads and writes about who tests. */
export interface TestingSettings {
  /** The Company's mode and every repo, whether or not it overrides it. */
  settings(): TestSettings
  /** The Company-wide mode. */
  mode(): TestMode
  setMode(mode: TestMode): TestSettings
  /** One repo's rule. `mode: null` puts it back on the Company's own. */
  setRepo(repoId: string, changes: RepoTestChanges): TestSettings
  /** One repo's rule as it is read, with the Company's mode already applied. */
  ofRepo(repoId: string): RepoTestSettings & { mode: TestMode }
  /**
   * The mode a ticket runs under: the strictest of its repos' (see `strictestMode`). A ticket in
   * no repo at all runs under the Company's own mode.
   */
  ofTicket(ticketId: number): TestMode
}

interface RepoTestRow {
  id: string
  test_mode: string | null
  run_command: string
  test_port: number | null
}

export function isTestMode(value: unknown): value is TestMode {
  return TEST_MODES.includes(value as TestMode)
}

export function createTestingSettings(db: DatabaseSync, onChange: () => void = () => {}): TestingSettings {
  function mode(): TestMode {
    const row = db.prepare('SELECT mode FROM testing_setting WHERE id = 1').get() as { mode: string } | undefined
    // A value the app no longer knows is not a reason to refuse every merge: fall back to the default.
    return isTestMode(row?.mode) ? row.mode : DEFAULT_TEST_MODE
  }

  function repoRows(): RepoTestRow[] {
    return db
      .prepare('SELECT id, test_mode, run_command, test_port FROM repo ORDER BY added_at, rowid')
      .all() as unknown as RepoTestRow[]
  }

  function toRepo(row: RepoTestRow): RepoTestSettings {
    return {
      repoId: row.id,
      mode: isTestMode(row.test_mode) ? row.test_mode : null,
      runCommand: row.run_command ?? '',
      port: row.test_port,
    }
  }

  function settings(): TestSettings {
    return { mode: mode(), repos: repoRows().map(toRepo) }
  }

  const testing: TestingSettings = {
    settings,
    mode,

    setMode(next) {
      if (!isTestMode(next)) throw new Error(`Unknown testing mode: ${String(next)}`)
      db.prepare(
        `INSERT INTO testing_setting (id, mode) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET mode = excluded.mode`,
      ).run(next)
      onChange()
      return settings()
    },

    setRepo(repoId, changes) {
      const row = db.prepare('SELECT id FROM repo WHERE id = ?').get(repoId) as { id: string } | undefined
      if (!row) throw new Error('There is no such repo')
      if (changes.mode !== undefined && changes.mode !== null && !isTestMode(changes.mode)) {
        throw new Error(`Unknown testing mode: ${String(changes.mode)}`)
      }
      if (changes.port !== undefined && changes.port !== null && !isValidPort(changes.port)) {
        throw new Error('A port must be a whole number between 1 and 65535')
      }
      const sets: string[] = []
      const values: (string | number | null)[] = []
      if (changes.mode !== undefined) {
        sets.push('test_mode = ?')
        values.push(changes.mode)
      }
      if (changes.runCommand !== undefined) {
        sets.push('run_command = ?')
        values.push(changes.runCommand.trim())
      }
      if (changes.port !== undefined) {
        sets.push('test_port = ?')
        values.push(changes.port)
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE repo SET ${sets.join(', ')} WHERE id = ?`).run(...values, repoId)
        onChange()
      }
      return settings()
    },

    ofRepo(repoId) {
      const row = db.prepare('SELECT id, test_mode, run_command, test_port FROM repo WHERE id = ?').get(repoId) as
        | RepoTestRow
        | undefined
      const base = row ? toRepo(row) : { repoId, mode: null, runCommand: '', port: null }
      return { ...base, mode: base.mode ?? mode() }
    },

    ofTicket(ticketId) {
      const row = db.prepare('SELECT repos FROM ticket WHERE id = ?').get(ticketId) as { repos: string } | undefined
      const repos = row ? (JSON.parse(row.repos) as string[]) : []
      if (repos.length === 0) return mode()
      return strictestMode(repos.map((repoId) => testing.ofRepo(repoId).mode))
    },
  }
  return testing
}
