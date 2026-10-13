import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BUSY_TIMEOUT_MS, COMPANY_FILE, openDatabaseFile } from './database'
import { removeFolder } from './testing'

/**
 * The bug, on a real file, with a real other process holding it (T252).
 *
 * Every other test about the database runs in memory, where there is no file, no journal and no OS
 * lock — which is exactly why "database is locked" reached a boss's first run and nothing in the
 * suite had ever seen it. So one test does the thing: a child process takes a write lock on a
 * Company database and keeps it for a moment while this process writes.
 *
 * Both arms are here on purpose. Without a busy timeout the write fails immediately, which is what
 * the boss met; with the app's own opener it waits and succeeds. A test that only proved the second
 * would still pass if the timeout were quietly dropped.
 */

/** How long the child keeps the lock. Long enough that the write really has to wait for it. */
const HELD_MS = 300

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) removeFolder(dir)
})

/**
 * A child process that takes a write lock on `file`, says `locked`, holds it for `HELD_MS` and
 * commits. `Atomics.wait` rather than a timer, because the lock must be held by a process that is
 * not running an event loop — a sleep that yields would let node:sqlite's own retry slip through
 * and the test would be about nothing.
 */
function holdWriteLock(file: string) {
  const script = `
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(${JSON.stringify(file)})
    db.exec('BEGIN IMMEDIATE')
    db.exec('CREATE TABLE IF NOT EXISTS held (id INTEGER)')
    console.log('locked')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HELD_MS})
    db.exec('COMMIT')
    db.close()
  `
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('locked')) resolve()
    })
    child.stderr.on('data', (chunk: Buffer) => reject(new Error(`the lock holder failed: ${chunk.toString()}`)))
    child.on('exit', (code) => reject(new Error(`the lock holder left with ${code} before it locked`)))
  })
  return { locked, done: new Promise<void>((resolve) => child.on('exit', () => resolve())) }
}

function companyFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-lock-'))
  tempDirs.push(dir)
  const db = openDatabaseFile(dir, 'create')!
  db.exec('CREATE TABLE company (id INTEGER)')
  db.close()
  return dir
}

describe('A write while another process holds the Company database', () => {
  it('waits for the lock and then goes through', async () => {
    const folder = companyFolder()
    const holder = holdWriteLock(join(folder, COMPANY_FILE))
    await holder.locked

    const db = openDatabaseFile(folder, 'existing')!
    const started = Date.now()
    db.exec('INSERT INTO company (id) VALUES (1)')
    const waited = Date.now() - started

    expect((db.prepare('SELECT COUNT(*) AS n FROM company').get() as { n: number }).n).toBe(1)
    // It really waited for the other process rather than finding the file free.
    expect(waited).toBeGreaterThan(HELD_MS / 3)
    expect(waited).toBeLessThan(BUSY_TIMEOUT_MS)
    db.close()
    await holder.done
  })

  it('is what the boss met without the timeout: SQLITE_BUSY on the first write', async () => {
    const folder = companyFolder()
    const holder = holdWriteLock(join(folder, COMPANY_FILE))
    await holder.locked

    // node:sqlite's default, which is what `openDatabaseFile` used until T252.
    const db = new DatabaseSync(join(folder, COMPANY_FILE))

    expect(() => db.exec('INSERT INTO company (id) VALUES (1)')).toThrow(/database is locked/i)
    db.close()
    await holder.done
  })
})
