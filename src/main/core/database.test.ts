import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUSY_TIMEOUT_MS,
  COMPANY_FILE,
  companyDatabaseExists,
  type Migration,
  openDatabaseFile,
  removeCreatedDatabase,
  runMigrations,
} from './database'
import { removeFolder } from './testing'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) removeFolder(dir)
})

function tempFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-db-'))
  tempDirs.push(dir)
  return dir
}

const a: Migration = { name: 'a', sql: 'CREATE TABLE a (id INTEGER)' }
const b: Migration = { name: 'b', sql: 'CREATE TABLE b (id INTEGER)' }
const c: Migration = { name: 'c', sql: 'CREATE TABLE c (id INTEGER)' }

function applied(db: DatabaseSync): string[] {
  return (db.prepare('SELECT name FROM schema_migration ORDER BY name').all() as { name: string }[]).map((r) => r.name)
}

function tables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((n) => n !== 'schema_migration')
}

describe('migrations', () => {
  it('applies each migration once, by name', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [a, b])
    runMigrations(db, [a, b])
    expect(tables(db)).toEqual(['a', 'b'])
  })

  it('applies a migration another branch inserted earlier in the list, instead of skipping it', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [a, c])
    runMigrations(db, [a, b, c])
    expect(tables(db)).toEqual(['a', 'b', 'c'])
  })

  it('adopts a database that only recorded a positional count', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(a.sql)
    db.exec(b.sql)
    db.exec('PRAGMA user_version = 2')
    runMigrations(db, [a, b, c])
    expect(tables(db)).toEqual(['a', 'b', 'c'])
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(0)
  })

  it('applies the whole run in one transaction: a failing step leaves no table behind', () => {
    const db = new DatabaseSync(':memory:')
    const bad: Migration = { name: 'bad', sql: 'CREATE TABLE' }

    expect(() => runMigrations(db, [a, bad])).toThrow()

    // Not even `a`, which came before it: a half-migrated Company is not a state anything can use.
    expect(tables(db)).toEqual([])
    expect(applied(db)).toEqual([])
    // And nothing was recorded, so the run is the same run again once the step is fixed.
    runMigrations(db, [a, { name: 'bad', sql: b.sql }])
    expect(tables(db)).toEqual(['a', 'b'])
  })

  it('reports what really failed, and not a rollback with no transaction left to roll back', () => {
    const db = new DatabaseSync(':memory:')
    /*
     * A run whose transaction is already closed when it fails. SQLite ends one itself on a few
     * failures — a disk that filled, an IO error, a lock it gave up on — and none of those can be
     * asked for in a test, so the step closes it by hand instead. What matters is the catch: an
     * unguarded `ROLLBACK` throws "cannot rollback - no transaction is active", and that is the
     * error the boss would be shown in place of the one that actually stopped the run.
     */
    const closesIt: Migration = { name: 'closes-it', sql: 'COMMIT; CREATE TABLE' }

    expect(() => runMigrations(db, [closesIt])).toThrow(/incomplete input/i)
    expect(db.isTransaction).toBe(false)
  })

  it('writes one journal cycle for the run, not one for every step', () => {
    const db = new DatabaseSync(':memory:')
    const begins: string[] = []
    const exec = db.exec.bind(db)
    db.exec = (sql: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) begins.push(sql)
      return exec(sql)
    }

    runMigrations(db, [a, b, c])

    expect(begins).toEqual(['BEGIN', 'COMMIT'])
  })

  it('does nothing at all when every migration is already applied', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [a, b])
    const statements: string[] = []
    const exec = db.exec.bind(db)
    db.exec = (sql: string) => {
      statements.push(sql)
      return exec(sql)
    }

    runMigrations(db, [a, b])

    expect(statements.filter((sql) => /^(BEGIN|COMMIT)/.test(sql))).toEqual([])
  })
})

describe('The opener', () => {
  it('waits for whoever holds the file instead of failing at once', () => {
    const folder = tempFolder()

    const db = openDatabaseFile(folder, 'create')!

    // node:sqlite's own default is 0, which is an immediate SQLITE_BUSY the first time anything
    // else — Defender, OneDrive, a second copy of the app — has the file for a moment (T252).
    expect(BUSY_TIMEOUT_MS).toBeGreaterThan(0)
    expect((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(BUSY_TIMEOUT_MS)
    db.close()
  })

  it('makes the folder a create names, because the Create step suggests one nobody has made', () => {
    const folder = join(tempFolder(), 'TinyCorp', 'Acme')

    const db = openDatabaseFile(folder, 'create')!
    db.close()

    expect(existsSync(join(folder, COMPANY_FILE))).toBe(true)
  })

  it('makes no folder and no file for an open', () => {
    const folder = join(tempFolder(), 'nowhere')

    expect(openDatabaseFile(folder, 'existing')).toBeNull()
    expect(existsSync(folder)).toBe(false)
  })
})

describe('Clearing up after a create that failed', () => {
  it('takes the database and its side files, and nothing else the folder held', () => {
    const folder = tempFolder()
    const db = openDatabaseFile(folder, 'create')!
    db.close()
    writeFileSync(join(folder, 'notes.md'), 'the boss picked their own folder')

    expect(companyDatabaseExists(folder)).toBe(true)
    removeCreatedDatabase(folder)

    expect(companyDatabaseExists(folder)).toBe(false)
    expect(existsSync(join(folder, 'notes.md'))).toBe(true)
    expect(existsSync(folder)).toBe(true)
  })

  it('is quiet about a folder that holds nothing of ours', () => {
    expect(() => removeCreatedDatabase(tempFolder())).not.toThrow()
  })
})
