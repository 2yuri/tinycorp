import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const COMPANY_FILE = 'company.sqlite'

/** The database and the side files SQLite keeps beside it, which belong to it and to nothing else. */
export const COMPANY_DATABASE_FILES = [
  COMPANY_FILE,
  `${COMPANY_FILE}-journal`,
  `${COMPANY_FILE}-wal`,
  `${COMPANY_FILE}-shm`,
] as const

/**
 * How long a write waits for whoever is holding the file before it gives up (T252).
 *
 * node:sqlite's own default is 0: the first moment another process holds the file is an immediate
 * `SQLITE_BUSY: database is locked`, and on Windows something holds a file in a boss's folder all
 * the time — Defender scanning a new file, OneDrive syncing it, the search indexer reading it,
 * another copy of the app. Five seconds is far longer than any of those keep it, and short enough
 * that a folder which really cannot be locked still says so while the boss is watching.
 */
export const BUSY_TIMEOUT_MS = 5_000

/**
 * Opens the SQLite database of the Company in `folder`.
 * With `mode: 'existing'` it returns null instead of creating a file.
 */
export type OpenDatabase = (folder: string, mode: 'create' | 'existing') => DatabaseSync | null

export const openDatabaseFile: OpenDatabase = (folder, mode) => {
  const file = join(folder, COMPANY_FILE)
  if (mode === 'existing' && !existsSync(file)) return null
  // Creating a Company creates the folder it goes in: the Create step suggests one under the boss's
  // home that nobody has made yet, and a folder they picked themselves is already there (T252).
  if (mode === 'create') mkdirSync(folder, { recursive: true })
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS })
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/** Whether `folder` already holds a Company database, asked before anything writes one. */
export function companyDatabaseExists(folder: string): boolean {
  return existsSync(join(folder, COMPANY_FILE))
}

/**
 * Removes the database a create made and the side files beside it — and nothing else (T252).
 *
 * A create that threw halfway used to leave an empty `company.sqlite` in the boss's folder, which
 * is then a Company that opens and has no tables. The folder itself stays whatever it was: it may
 * be one the boss already had, with their own files in it.
 */
export function removeCreatedDatabase(folder: string): void {
  for (const name of COMPANY_DATABASE_FILES) rmSync(join(folder, name), { force: true })
}

/** A schema migration, applied once and tracked by name so parallel branches cannot skip each other's steps. */
export interface Migration {
  /** Unique, never renamed. */
  name: string
  sql: string
}

/**
 * Applies every migration whose name is not yet recorded, in list order, in one transaction.
 *
 * One transaction for the whole run and not one each (T252): a brand-new Company has 64 steps to
 * apply, and each `BEGIN`/`COMMIT` is a journal file written, fsynced and deleted in the folder the
 * boss picked. That was 64 chances for Defender or a sync client to be holding the file at the
 * wrong moment, for no gain — a half-migrated Company is not a state anything can use, so a failure
 * rolls the whole run back and the database stays the version it was.
 *
 * Exported for tests.
 */
export function runMigrations(db: DatabaseSync, list: readonly Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  adoptPositionalHistory(db, list)
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migration').all() as { name: string }[]).map((r) => r.name),
  )
  const pending = list.filter((migration) => !applied.has(migration.name))
  if (pending.length === 0) return
  db.exec('BEGIN')
  try {
    const record = db.prepare('INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)')
    for (const migration of pending) {
      db.exec(migration.sql)
      record.run(migration.name, new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) {
    // Only a transaction that is still open. SQLite ends one itself on some failures, and a
    // `ROLLBACK` with nothing to roll back throws — reporting "no transaction is active" in place
    // of the error that actually stopped the run.
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Databases created before migrations were named only carry PRAGMA user_version = count.
 * Record the first `count` names as applied once, then stop using user_version.
 */
function adoptPositionalHistory(db: DatabaseSync, list: readonly Migration[]): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  if (version <= 0) return
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number }
  if (n === 0) {
    const record = db.prepare('INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)')
    for (const migration of list.slice(0, version)) record.run(migration.name, new Date().toISOString())
  }
  db.exec('PRAGMA user_version = 0')
}
