import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import * as nodePath from 'node:path'
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { isNetworkFolder } from '../../shared/platform/company-folder'
import type { RepoRegistry } from '../features/repos'
import { createGitRunner, excludeFromGit } from '../platform'

/**
 * What a Company keeps in its folder that must never enter a repo (decision 45), as `.gitignore`
 * patterns relative to the Company folder. Kept free of engine imports so code-flow can use it.
 */
export const COMPANY_DATA_PATTERNS = [
  'company.sqlite*',
  '.tinycorp/',
  'memory/',
  'worktrees/',
  'attachments/',
  'testing/',
  'restore-points/',
] as const

/** Whether `path` is `folder` or somewhere inside it. */
export function isInsideFolder(path: string, folder: string): boolean {
  const rel = relative(resolve(folder), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The `.gitignore` lines that keep a Company's data out of the repo at `repoPath`: anchored to the
 * Company folder, so a project's own `memory/` elsewhere stays tracked. Empty when the Company's data
 * cannot be inside the repo, e.g. a repo that sits beside or inside the Company folder.
 */
export function companyDataIgnores(repoPath: string, companyFolder: string): string[] {
  if (!isInsideFolder(companyFolder, repoPath)) return []
  const rel = relative(resolve(repoPath), resolve(companyFolder)).split(sep).join('/')
  const prefix = rel ? `/${rel}/` : '/'
  return COMPANY_DATA_PATTERNS.map((pattern) => `${prefix}${pattern}`)
}

/**
 * Appends to the repo's `.gitignore` every Company-data line it lacks, for each of the Company
 * folders, creating the file when needed. Idempotent. Returns the lines it added. A repo folder
 * that is not on disk is left alone.
 */
export function ignoreCompanyData(repoPath: string, companyFolders: string[]): string[] {
  const wanted = [...new Set(companyFolders.flatMap((folder) => companyDataIgnores(repoPath, folder)))]
  if (wanted.length === 0 || !isFolder(repoPath)) return []
  const file = join(resolve(repoPath), '.gitignore')
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const present = new Set(before.split(/\r?\n/).map((line) => line.trim()))
  const missing = wanted.filter((line) => !present.has(line))
  if (missing.length === 0) return []
  const lead = before === '' ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(file, `${before}${lead}# tinycorp Company data\n${missing.join('\n')}\n`)
  return missing
}

/**
 * The same lines as `ignoreCompanyData`, written to the checkout's `info/exclude` instead of its
 * `.gitignore` (T38). A ticket worktree is where the two differ: its `.gitignore` is the branch's,
 * so writing there would be a change the Employee has to explain in their PR, while `info/exclude`
 * is never tracked. The lines are anchored to the checkout `companyFolder` sits in — a worktree's
 * root, not the repo's — and land in the git dir the repo's worktrees share. Returns the lines it
 * added, none when the folder is in no checkout at all.
 */
export function excludeCompanyDataFromGit(companyFolder: string): string[] {
  const top = gitToplevel(companyFolder)
  if (!top) return []
  // Both sides through the same realpath: git answers with forward slashes and, on Windows, with
  // the long name of a folder whose short `RUNNER~1` form the app may be holding. Two spellings of
  // the one folder used to read as two folders, and nothing was excluded at all (T166).
  const lines = companyDataIgnores(top, truePath(companyFolder))
  if (lines.length === 0) return []
  excludeFromGit(companyFolder, lines)
  return lines
}

/** The root of the checkout `path` is in — a worktree's own root, not the repo's — or null. */
function gitToplevel(path: string): string | null {
  if (!isFolder(path)) return null
  // Through the runner, because a Company folder can be inside a WSL distro since T256: there the
  // distro's own git answers, where git for Windows refuses the repo outright. And `mapPaths`,
  // because inside a distro git answers `/home/b/acme` while everything below — the `.gitignore`
  // this writes, the realpath it compares against — is a path this process opens (T259).
  const top = createGitRunner().tryText(path, ['rev-parse', '--show-toplevel'], { mapPaths: true })?.trim()
  return top ? truePath(top) : null
}

/**
 * Where a repo's ticket worktrees go: `root` unless that lies inside the repo, e.g. the repo is the
 * Company folder; then a `<repo>-worktrees` folder beside the repo, so worktrees never nest in it.
 */
export function worktreeRootOutside(root: string, repoPath: string | undefined): string {
  if (!repoPath || !isInsideFolder(root, repoPath)) return root
  return worktreesBeside(repoPath)
}

/** The `<repo>-worktrees` folder beside the repo, in the repo's own spelling. */
export function worktreesBeside(repoPath: string): string {
  const path = spelling(repoPath)
  const repo = path.resolve(repoPath)
  return path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`)
}

/**
 * Whether two folders are on the same kind of filesystem: both on a drive of this PC, or both on
 * something Windows reaches over UNC — a WSL distro's own filesystem, a NAS.
 *
 * It is the question a ticket's worktree is placed by (T255). A Company folder is on a drive of
 * this PC — T252 refuses a share, because SQLite cannot lock a file over one — while a repo has no
 * such rule and the boss's repos may well live inside WSL. Put those two together the old way and
 * `git worktree add` writes the worktree onto `C:`, and the Employee inside the distro then edits,
 * builds and installs through `/mnt/c`: drvfs, the slowest path WSL has, with file watchers that
 * do not fire.
 *
 * Asking about the *kind* rather than about WSL is what keeps the rule true from both ends. A
 * Company folder that is itself in the distro is on the same kind as the repo, so its worktrees
 * stay under it, where they are already inside the distro and nothing has to move.
 */
export function sameFilesystemKind(a: string, b: string): boolean {
  return isNetworkFolder(a) === isNetworkFolder(b)
}

/** `folder`'s child, in the folder's own spelling. */
export function inFolder(folder: string, child: string): string {
  return spelling(folder).join(folder, child)
}

/**
 * `node:path` in the spelling `path` is written in: `win32` for a UNC share, which only Windows
 * has, and this platform's own for everything else. Without it a suite on a Mac reads
 * `\\wsl.localhost\Arch\home\b\app` with the POSIX rules, where it is one filename with no
 * parent at all, and the test would only ever be about Windows.
 */
function spelling(path: string): nodePath.PlatformPath {
  return isNetworkFolder(path) ? win32 : nodePath
}

/** The registry, with attaching a repo also ignoring the data of every Company folder it touches. */
export function ignoringCompanyData(registry: RepoRegistry, companyFolders: () => string[]): RepoRegistry {
  return {
    ...registry,
    add(input) {
      const repo = registry.add(input)
      ignoreCompanyData(repo.path, companyFolders())
      return repo
    },
  }
}

/** A folder's one true path: the native realpath, which is the only one that expands `RUNNER~1`. */
function truePath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
