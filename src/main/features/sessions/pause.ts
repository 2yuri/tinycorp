import type { DatabaseSync } from 'node:sqlite'
import type { Employee } from '../../../shared/domain/staff'
import type { ResumeAll, ResumeFailure } from '../../../shared/session'
import type { Migration } from '../../core'
import type { Sessions } from './sessions'

/**
 * A Company the boss paused (decision 38), and the Employees whose Sessions `Resume all` brings
 * back. Both survive closing the app, so a paused Company reopens paused.
 */
export const PAUSE_MIGRATION: Migration = {
  name: 'sessions-pause',
  sql: `
  CREATE TABLE company_pause (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    paused_at TEXT NOT NULL
  );
  CREATE TABLE paused_session (
    employee_id TEXT PRIMARY KEY REFERENCES employee (id)
  );
`,
}

/** The current Company's Sessions with `Pause all` and `Resume all`. */
export interface PausableSessions extends Sessions {
  /**
   * Pause all: stops every running or parked Session of the current Company and keeps the
   * Company paused, across restarts, until `startAll`. While paused, `start` refuses.
   */
  stopAll(): void
  /**
   * Resume all: lifts the pause and starts, continuing their last conversation, the Sessions
   * `stopAll` stopped plus anyone held back while paused; beyond the concurrency cap they park.
   *
   * It answers what it came to (T217). A pause that held nobody — every Session was already off, or
   * an older build wrote the pause row without them — used to lift the pause, start nobody and say
   * nothing, which from the boss's side is a button that does not work. It now falls back to what a
   * reopen still owed a Session, and when neither knows of one it says so.
   */
  startAll(): ResumeAll
  /** Whether the current Company is paused. */
  paused(): boolean
}

export interface PauseService {
  sessions: PausableSessions
  /** Like `sessions.start`, but while paused the Employee is held back for `Resume all` instead of refused. */
  startOrHold(employeeId: string): void
}

export interface PauseOptions {
  /** The Sessions below: `stop` forgets the Employee should come back on the next open. */
  sessions: Sessions
  /** Starts an Employee's Session so it continues its last conversation. */
  resume(employeeId: string): void
  /**
   * The Employees whose Sessions should come back on the next open. A pause holds these beyond
   * what is running right now, because a Company paused before its Sessions came back was running
   * nothing to hold; `Resume all` falls back to them when the pause held nobody (T217).
   */
  restoring(): string[]
  /** The current Company's name, database and Employees; throws when none is open. */
  current(): { name: string; db: DatabaseSync; employees: Employee[] }
  log(line: string): void
}

export function createPause({ sessions: inner, resume, restoring, current, log }: PauseOptions): PauseService {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const isPaused = (db: DatabaseSync) => db.prepare('SELECT 1 FROM company_pause WHERE id = 1').get() !== undefined
  const hold = (db: DatabaseSync, employeeId: string) =>
    db.prepare('INSERT INTO paused_session (employee_id) VALUES (?) ON CONFLICT DO NOTHING').run(employeeId)

  const sessions: PausableSessions = {
    ...inner,

    start(employeeId) {
      const { name, db } = current()
      if (isPaused(db)) throw new Error(`${name} is paused: Resume all to start Sessions`)
      return inner.start(employeeId)
    },

    stop(employeeId) {
      current().db.prepare('DELETE FROM paused_session WHERE employee_id = ?').run(employeeId)
      return inner.stop(employeeId)
    },

    onChange(listener) {
      listeners.add(listener)
      const off = inner.onChange(listener)
      return () => {
        listeners.delete(listener)
        off()
      }
    },

    stopAll() {
      const { db } = current()
      const on = inner.list().filter((s) => s.status !== 'off')
      /*
       * Who `Resume all` brings back: everyone running now, and everyone a reopen still owed a
       * Session. The second half is the hole the boss fell into (T217) — a Company paused before
       * its Sessions had come back, or after they died, was running nothing, so the pause held
       * nobody and `Resume all` had nothing to bring.
       *
       * The pause row and the holds go in one transaction: a pause recorded without them is the
       * state that cannot be resumed at all.
       */
      const held = new Set([...on.map((s) => s.employeeId), ...restoring()])
      db.exec('BEGIN')
      try {
        db.prepare('INSERT INTO company_pause (id, paused_at) VALUES (1, ?) ON CONFLICT (id) DO NOTHING').run(
          new Date().toISOString(),
        )
        for (const employeeId of held) hold(db, employeeId)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      // Parked ones first: stopping a running one frees a slot the next parked one would take.
      const parkedFirst = [...on].sort((a, b) => Number(b.status === 'parked') - Number(a.status === 'parked'))
      for (const { employeeId } of parkedFirst) {
        try {
          inner.stop(employeeId)
        } catch (error) {
          log(`Pause: could not stop Employee ${employeeId}: ${(error as Error).message}`)
        }
      }
      notify()
    },

    startAll() {
      const { db, employees } = current()
      const held = new Set(
        (db.prepare('SELECT employee_id FROM paused_session').all() as { employee_id: string }[]).map(
          (r) => r.employee_id,
        ),
      )
      // A pause that held nobody is not a Company with nobody to bring back: it is a pause row
      // written without its holds, by a build that wrote none or before this one held the reopen's
      // own list. That list is the same knowledge one step older, so it is what `Resume all` takes.
      const from = held.size > 0 ? 'held' : 'restoring'
      const bring = held.size > 0 ? held : new Set(restoring())
      db.exec('DELETE FROM paused_session; DELETE FROM company_pause;')
      notify()
      const resumed: string[] = []
      const failed: ResumeFailure[] = []
      for (const employee of [...employees].sort((a, b) => a.desk - b.desk)) {
        if (!bring.has(employee.id)) continue
        try {
          resume(employee.id)
          resumed.push(employee.id)
        } catch (error) {
          const reason = (error as Error).message
          log(`Pause: could not resume ${employee.name}: ${reason}`)
          failed.push({ employeeId: employee.id, name: employee.name, reason })
        }
      }
      const nothing = resumed.length === 0 && failed.length === 0
      return { paused: isPaused(db), resumed, failed, from: nothing ? 'nobody' : from }
    },

    paused: () => isPaused(current().db),
  }

  return {
    sessions,

    startOrHold(employeeId) {
      const { db } = current()
      if (!isPaused(db)) return void inner.start(employeeId)
      hold(db, employeeId)
      notify()
    },
  }
}
