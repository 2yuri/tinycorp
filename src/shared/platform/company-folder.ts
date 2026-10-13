/**
 * Where a Company's folder may be, where one is suggested, and what to say about the rest (T252, T256).
 *
 * A Company is a folder with a SQLite database, and SQLite holds a lock on that file for every
 * write. Over a network share there is no lock to hold: Windows reaches a WSL distro's own
 * filesystem as `\\wsl.localhost\<distro>\…` and a NAS as `\\nas\share\…`, and the very first
 * write on either fails with `SQLITE_BUSY: database is locked` — which is exactly what a boss met
 * on their first run, because Windows' folder picker opened inside the WSL share where it had last
 * been and accepting it was one click.
 *
 * T252 refused both. T256 refuses only the second, because the boss was right that no other app
 * does this: VS Code keeps `state.vscdb` in AppData and JetBrains its indexes in `%LOCALAPPDATA%`,
 * and the project folder holds files. So a Company folder in WSL is accepted and its database
 * stays on this PC — see `main/core/company-databases.ts`, which is where that happens. A folder
 * on any *other* share is still refused, because a folder a second PC can open would end up with
 * one database per PC and no way to say which is the Company.
 *
 * The refusal and the note are checked in the renderer the moment the folder is picked *and* in
 * the main process before any file is written — the same rule in both places, which is why they
 * live here rather than in `main/platform` where the renderer could not read them
 * (`absolute-path.ts` says the same).
 *
 * The suggestion is the other half: nobody should have to open the picker at all, so the Create
 * step shows `<home>/TinyCorp/<Company name>` until the boss picks something else. It is built
 * from strings rather than `node:path` for the same reason — there is no `node:path` in the
 * renderer — and it takes the separator from the shape of the home folder it was handed.
 */

import { isUnderAnyRoot } from './temporary-folder'

/** What the main process tells the Create step about folders: it knows the home folder and the env. */
export interface CompanyFolderHints {
  /** The boss's home folder, `app.getPath('home')`. Null until the main process has answered. */
  home: string | null
  /** The folders OneDrive syncs, from its own environment variables. Empty where it is not running. */
  syncedRoots: readonly string[]
}

/** No answer yet: no suggestion, and nothing to say. */
export const NO_FOLDER_HINTS: CompanyFolderHints = { home: null, syncedRoots: [] }

/** The folder TinyCorp suggests keeping Companies in, under the boss's home. */
export const COMPANIES_FOLDER = 'TinyCorp'

/**
 * Why a folder on a network share is refused (T252), now that a WSL folder is not (T256): the
 * database of a Company in WSL stays on this PC, but a folder another PC can also open would end
 * up with one database per PC.
 */
export const NETWORK_FOLDER_REFUSAL =
  'A Company folder has to be on a drive of this PC or in WSL — a folder another PC can also open would end up ' +
  'with one database per PC. Pick a folder on C: or another drive, or in WSL.'

export const SYNCED_FOLDER_WARNING =
  "This folder is synced by OneDrive, which can lock the Company's database while it syncs. " +
  'A folder outside OneDrive is safer.'

/**
 * A Company folder in WSL whose database this PC does not hold: another PC's, or an AppData that
 * has been wiped. There is nothing to open and nothing to repair from here, so the Launcher says
 * this and offers Forget (T256).
 */
export const DATABASE_ON_ANOTHER_PC = "This Company's database is on another PC."

export const WSL_FOLDER_NOTE =
  "Lives in WSL. Its database stays on this PC, in AppData — SQLite can't lock a file across the WSL share."

/**
 * Whether Windows reaches `folder` over the network: a UNC path, `\\server\share\…`, and the two
 * spellings of a WSL distro's own filesystem, `\\wsl.localhost\…` and `\\wsl$\…`.
 *
 * Both leading backslashes are the whole test, because every one of those shapes starts with them
 * and nothing on a local drive does. A path on macOS or Linux cannot be one, so off Windows this
 * is a no-op — which is also why it is not a guess about a folder's name.
 *
 * It says nothing about whether a Company may live there — `companyFolderRefusal` is that question,
 * and since T256 the two answers differ for WSL. What it is still exactly right for is the kind of
 * filesystem a path is on, which is what `sameFilesystemKind` places a ticket's worktree by (T255).
 */
export function isNetworkFolder(folder: string): boolean {
  return folder.trim().startsWith('\\\\')
}

/** The two spellings Windows reaches a WSL distro's own filesystem through. */
const WSL_PREFIXES = ['\\\\wsl.localhost\\', '\\\\wsl$\\'] as const

/**
 * Whether `folder` is inside a WSL distro's own filesystem, in either spelling (T256).
 *
 * The prefix alone is the test, and it holds off Windows too, so the renderer, the engine and the
 * suite all read the same answer from the same string. A distro *named* `wsl.localhost` on a share
 * of that name is not a thing Windows can make.
 */
export function isWslFolder(folder: string): boolean {
  const path = folder.trim().toLowerCase()
  return WSL_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** Why `folder` cannot hold a Company, in words for the boss, or null when it can. */
export function companyFolderRefusal(folder: string): string | null {
  if (isWslFolder(folder)) return null
  return isNetworkFolder(folder) ? NETWORK_FOLDER_REFUSAL : null
}

/**
 * The folder a Company called `name` is suggested in: `C:\Users\you\TinyCorp\Acme`, or
 * `~/TinyCorp/Acme`. Null while there is no home folder or no name yet, which is the Create step's
 * placeholder rather than a path.
 */
export function suggestedCompanyFolder(home: string | null, name: string): string | null {
  const leaf = folderName(name)
  if (!home || !leaf) return null
  const separator = home.includes('\\') || /^[a-zA-Z]:/.test(home) ? '\\' : '/'
  return [home.replace(/[\\/]+$/, ''), COMPANIES_FOLDER, leaf].join(separator)
}

/**
 * The Company's name as one folder: the characters Windows forbids become `-`, and a trailing dot
 * or space goes, because Windows silently drops those and the folder would not be the one named.
 */
function folderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\s.]+$/, '')
}

/** A line under the folder field: something true of the folder that is not a reason to refuse it. */
export interface CompanyFolderNote {
  text: string
  /**
   * An `info` mark beside the line (frame `iNGDQ`), for something the boss should know rather than
   * avoid. The OneDrive warning carries none: it is asking them to pick elsewhere.
   */
  info: boolean
}

/** What is worth saying about `folder` without refusing it, or null when there is nothing. */
export function companyFolderNote(folder: string, hints: CompanyFolderHints): CompanyFolderNote | null {
  if (isWslFolder(folder)) return { text: WSL_FOLDER_NOTE, info: true }
  if (isUnderAnyRoot(folder, hints.syncedRoots)) return { text: SYNCED_FOLDER_WARNING, info: false }
  return null
}
