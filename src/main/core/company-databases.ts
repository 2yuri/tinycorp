import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isWslFolder } from '../../shared/platform/company-folder'
import {
  COMPANY_DATABASE_FILES,
  companyDatabaseExists,
  type OpenDatabase,
  openDatabaseFile,
  removeCreatedDatabase,
} from './database'

/**
 * Where a Company's database file lives, which is not always in the Company's folder (T256).
 *
 * T252 refused a Company folder on a WSL share, because SQLite cannot lock a file over one. The
 * boss's answer was that it is impossible every app does this, and they were right: VS Code keeps
 * `state.vscdb` in AppData and runs a server inside the distro, JetBrains keeps its indexes in
 * `%LOCALAPPDATA%`. The project folder holds files; the databases stay on the PC.
 *
 * So for a Company folder on a WSL share, and only there, `company.sqlite` and the journal beside
 * it live in `%LOCALAPPDATA%\TinyCorp\Companies\<company id>\`, and the folder carries
 * `.tinycorp/company.json` naming that id. Everything else — the memory wiki, notes, worktrees,
 * Session config — stays in the Company folder where the Employees inside the distro reach it
 * natively. A Company on a drive of this PC keeps its database inside its folder, exactly as it
 * always has, and writes no id file at all.
 *
 * `LOCALAPPDATA` and never `APPDATA`: the roaming profile is synced between machines by domain
 * policy, and a live SQLite database being copied out from under the process is the failure this
 * whole module exists to avoid.
 *
 * The share test is injected rather than read off `process.platform`, so the suite exercises the
 * real code on every runner against a temp folder it declares to be one — a UNC path cannot be
 * made on a Mac, and a test that could only run on Windows is a test that runs nowhere.
 */

/** The folder a Company carries the file naming its id in, when its database is not in the folder. */
export const COMPANY_MARKER_FOLDER = '.tinycorp'

/** The file itself: `{ "id": …, "database": "this-pc" }`. A plain write, which the share handles. */
export const COMPANY_MARKER_FILE = 'company.json'

/** What the file says when the database is on this PC rather than beside it. */
export const DATABASE_ON_THIS_PC = 'this-pc'

/** Under `%LOCALAPPDATA%`: one folder per Company whose own folder cannot hold a database. */
export const APP_DATA_COMPANIES = ['TinyCorp', 'Companies'] as const

/** Where one Company's `company.sqlite` is, and the id it is filed under when it is not in the folder. */
export interface DatabaseSite {
  /** The folder holding `company.sqlite`. */
  folder: string
  /** The Company id keying that folder, when the database is not in the Company folder; else null. */
  id: string | null
}

export interface CompanyDatabases {
  /** Where the Company in `folder` keeps its database, as the folder itself says. */
  of(folder: string): DatabaseSite
  /**
   * The same, for a Company about to be created in `folder`: where the folder cannot hold a
   * database, this allocates the site on this PC and writes the id file. Idempotent — a folder that
   * already names an id keeps it, so `id` is only ever the id of a Company that has none yet.
   */
  claim(folder: string, id?: string): DatabaseSite
  /** Opens the database of the Company in `folder`, at whichever site the folder names. */
  open: OpenDatabase
  /**
   * Removes this Company's database wherever it is, and the id file that named it. Nothing else in
   * the folder is touched: `removeCompanyData` is what clears the rest.
   */
  remove(folder: string): void
  /**
   * Carries the database across a move of the Company folder — into the folder when it leaves the
   * share, out to this PC when it enters one. `was` is the site the folder had *before* it moved,
   * read while it was still where it was; `to` is where the folder is now.
   */
  moved(was: DatabaseSite, to: string, id: string): void
}

export interface CompanyDatabasesOptions {
  /**
   * `%LOCALAPPDATA%`, where a Company folder that cannot hold a database keeps it. Defaults to the
   * environment's, and is null everywhere but Windows — where a WSL share cannot exist either.
   */
  localAppData?: string | null
  /** Whether a Company folder is a share SQLite cannot lock a file on. Defaults to the WSL test. */
  onShare?(folder: string): boolean
}

/**
 * What is said when a Company folder is on a share and there is nowhere on this PC to put its
 * database. On Windows `LOCALAPPDATA` is always set, so this is the shape of a machine nobody has,
 * said out loud rather than quietly writing a database where the first write would fail (T252).
 */
export const NO_LOCAL_APP_DATA =
  "This Company's folder is in WSL, so its database has to live on this PC — and TinyCorp cannot " +
  'find %LOCALAPPDATA% to put it in.'

export function companyDatabases({
  localAppData = process.env['LOCALAPPDATA'] ?? null,
  onShare = isWslFolder,
}: CompanyDatabasesOptions = {}): CompanyDatabases {
  /** `%LOCALAPPDATA%\TinyCorp\Companies\<id>`, or the refusal when there is no such place. */
  function onThisPc(id: string): string {
    if (!localAppData) throw new Error(NO_LOCAL_APP_DATA)
    return join(localAppData, ...APP_DATA_COMPANIES, id)
  }

  function markerFile(folder: string): string {
    return join(folder, COMPANY_MARKER_FOLDER, COMPANY_MARKER_FILE)
  }

  /** Files the Company in `folder` under `id` on this PC, keeping an id the folder already names. */
  function allocate(folder: string, id: string): DatabaseSite {
    const already = readMarker(markerFile(folder))
    if (already) return { folder: onThisPc(already), id: already }
    writeMarker(markerFile(folder), id)
    return { folder: onThisPc(id), id }
  }

  const databases: CompanyDatabases = {
    of(folder) {
      const id = readMarker(markerFile(folder))
      if (id) return { folder: onThisPc(id), id }
      // No id file: the database is in the folder — which is every Company on a drive, and also a
      // folder that was one and has been carried into the distro, database and all, by hand.
      return { folder, id: null }
    },

    claim(folder, id = randomUUID()) {
      const already = databases.of(folder)
      if (already.id !== null || !onShare(folder)) return already
      // A folder that already holds a database keeps it: a Company somebody carried into the
      // distro themselves goes on working, rather than being split from its own tables. A move
      // does not come through here, because there the database in the folder is the one to carry.
      if (companyDatabaseExists(folder)) return already
      return allocate(folder, id)
    },

    open(folder, mode) {
      // A create claims first, so a folder that cannot hold a database never has one written into
      // it — `createCompany` claims too, for the id, and a claim is idempotent.
      const site = mode === 'create' ? databases.claim(folder) : databases.of(folder)
      return openDatabaseFile(site.folder, mode)
    },

    remove(folder) {
      const site = databases.of(folder)
      if (site.id === null) removeCreatedDatabase(folder)
      else rmSync(site.folder, { recursive: true, force: true })
      rmSync(join(folder, COMPANY_MARKER_FOLDER), { recursive: true, force: true })
    },

    moved(was, to, id) {
      if (was.id !== null && !onShare(to)) {
        // Out of the distro: the database comes back into the folder it belongs to, and the id
        // file — which travelled with the folder — has nothing left to name.
        carry(was.folder, to)
        rmSync(was.folder, { recursive: true, force: true })
        rmSync(join(to, COMPANY_MARKER_FOLDER), { recursive: true, force: true })
        return
      }
      if (was.id === null && onShare(to)) {
        // Into the distro: the database travelled with the folder and is now on the share, where
        // the first write would fail. It goes to this PC, under the Company's own id.
        carry(to, allocate(to, id).folder)
      }
      // Share to share, or drive to drive: the database is already where it should be.
    },
  }
  return databases
}

/** Moves `company.sqlite` and its side files from one folder to the other, across disks if it must. */
function carry(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const name of COMPANY_DATABASE_FILES) {
    const source = join(from, name)
    if (!existsSync(source)) continue
    const target = join(to, name)
    try {
      renameSync(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      // A share and a drive are always two devices, so this is the path a real move takes.
      copyFileSync(source, target)
      rmSync(source, { force: true })
    }
  }
}

/** The id `file` names, or null when there is no file, it is not ours, or it says nothing useful. */
function readMarker(file: string): string | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { id, database } = parsed as { id?: unknown; database?: unknown }
    if (database !== DATABASE_ON_THIS_PC || typeof id !== 'string' || id.trim() === '') return null
    return id
  } catch {
    return null
  }
}

function writeMarker(file: string, id: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ id, database: DATABASE_ON_THIS_PC }, null, 2)}\n`)
}
