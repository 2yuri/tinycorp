import type { DatabaseSync } from 'node:sqlite'
import type { Company, CompanySummary } from '../../../shared/company'
import { companyKeyFrom } from '../../../shared/company'
import type { SessionStatus } from '../../../shared/session'
import {
  type CompanyDatabases,
  companyDatabaseExists,
  companyDatabases,
  type Migration,
  type OpenDatabase,
} from '../../core'
import { readOnboardingCompletedAt } from '../onboarding'
import type { SessionActivity } from '../sessions'
import { folderState, type PathExists } from './missing-folders'

/** The company-visits migration step, appended to the engine's migrations. */
export const COMPANY_VISITS_MIGRATION: Migration = {
  name: 'company-visits-last-opened',
  sql: `
  CREATE TABLE company_visit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_opened_at TEXT NOT NULL
  );
`,
}

/** Statuses that hold no running process. */
const NOT_RUNNING: SessionStatus[] = ['off', 'parked']

export interface CompanySummariesOptions {
  /** Every known Company: open now or opened before. */
  companies(): Company[]
  /** The database of an open Company, or undefined when it is not open. */
  openDatabase(companyId: string): DatabaseSync | undefined
  currentId(): string | null
  /** Opens a Company folder that is not open, to read it. */
  readFolder: OpenDatabase
  /** Which folder each Company's database is in (T256). Defaults to the real answer. */
  databases?: CompanyDatabases
  /** Every Session status change of any open Company. */
  onActivity(listener: (activity: SessionActivity) => void): () => void
  /** Whether a folder is on disk; the default asks the real filesystem. */
  exists?: PathExists
  now?: () => Date
}

export interface CompanySummaries {
  list(): CompanySummary[]
  /** Records that an open Company is in use now. Never throws. */
  visited(db: DatabaseSync): void
  close(): void
}

/** What the Launcher shows for each known Company: staff, running Sessions and last visit. */
export function createCompanySummaries({
  companies,
  openDatabase,
  currentId,
  readFolder,
  databases = companyDatabases(),
  onActivity,
  exists,
  now = () => new Date(),
}: CompanySummariesOptions): CompanySummaries {
  /** Company of every Employee whose Session runs now. */
  const running = new Map<string, string>()
  const stop = onActivity(({ companyId, employeeId, status }) => {
    if (NOT_RUNNING.includes(status)) running.delete(employeeId)
    else running.set(employeeId, companyId)
  })

  type Read = Pick<CompanySummary, 'employees' | 'lastOpenedAt' | 'onboardingCompletedAt'>

  function read(db: DatabaseSync, company: Company): Read {
    const employees = db.prepare('SELECT COUNT(*) AS n FROM employee WHERE fired_at IS NULL').get() as {
      n: number
    }
    const visit = db.prepare('SELECT last_opened_at FROM company_visit WHERE id = 1').get() as
      | { last_opened_at: string }
      | undefined
    return {
      employees: Number(employees.n),
      lastOpenedAt: visit?.last_opened_at ?? null,
      onboardingCompletedAt: readOnboardingCompletedAt(db, company.createdAt),
    }
  }

  function readClosed(company: Company): Read {
    // A folder that cannot be read has no wizard to resume.
    const unreadable = { employees: null, lastOpenedAt: null, onboardingCompletedAt: company.createdAt }
    let db: DatabaseSync | null = null
    try {
      db = readFolder(company.folder, 'existing')
      return db ? read(db, company) : unreadable
    } catch {
      return unreadable
    } finally {
      if (db?.isOpen) db.close()
    }
  }

  /**
   * Whether the folder names a database on this PC that is not here (T256). Asked only of a
   * Company that is not open, and only ever true of a Company folder in WSL: everywhere else the
   * folder holds its own database and the answer is the folder's own state.
   */
  function databaseElsewhere(folder: string): boolean {
    try {
      const site = databases.of(folder)
      return site.id !== null && !companyDatabaseExists(site.folder)
    } catch {
      // The folder names a database this machine has nowhere to keep — a Company folder carried to
      // a Mac. There is still nothing to open, which is all the row has to say.
      return true
    }
  }

  return {
    list() {
      const current = currentId()
      return companies().map((company) => {
        const db = openDatabase(company.id)
        const sessions = [...running.values()].filter((id) => id === company.id).length
        return {
          ...company,
          key: company.key ?? companyKeyFrom(company.name),
          open: !!db,
          current: company.id === current,
          ...(db ? read(db, company) : readClosed(company)),
          sessions: db ? sessions : 0,
          // An open Company has its database in hand, so its row stays whatever the folder does.
          missing: db ? false : folderState(company.folder, exists) !== 'present',
          databaseElsewhere: db ? false : databaseElsewhere(company.folder),
        }
      })
    },

    visited(db) {
      // Bookkeeping only: a database that cannot take the write never breaks opening or closing.
      if (!db.isOpen) return
      try {
        db.prepare(
          `INSERT INTO company_visit (id, last_opened_at) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET last_opened_at = excluded.last_opened_at`,
        ).run(now().toISOString())
      } catch {
        // The Company still opens; its card shows no last visit.
      }
    },

    close() {
      stop()
      running.clear()
    },
  }
}
