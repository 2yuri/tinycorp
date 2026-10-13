import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangedFile, ChangedFileDiff, ChangeMark, PlaceChanges } from '../../../shared/files/file-changes'
import type { FilePlace } from '../../../shared/files/files'
import { diffFilesOf } from '../../../shared/review/diff-parse'
import type { DiffFile } from '../../../shared/review/review-diff'
import { createGitRunner, type GitRunner } from '../../platform'

/** How many changed files one place ever lists. Past it the list says it stopped short. */
export const CHANGES_LIMIT = 500

/** How much patch text one file's diff may carry before git is asked to stop. */
const DIFF_BUFFER = 16 * 1024 * 1024

/** What reading and changing a place's git status needs; injected so tests need no checkout. */
export interface ChangesGit {
  /**
   * `git status -z --porcelain --branch --untracked-files=all` as it came out, or null when the
   * folder is not a git worktree any more. A worktree that has gone is not an error.
   */
  status(folder: string): string | null
  /** The unified diff of one path against HEAD, index and working tree together. */
  diff(request: { folder: string; path: string; previousPath: string | null }): string
  /**
   * One file as HEAD has it, or null when HEAD never had it. The base side of what the diff editor
   * draws (T243); the head side is simply the file on disk.
   */
  atHead(request: { folder: string; path: string }): string | null
  /** The file as it is in the working tree now, or null when it is not there (or is not text). */
  working(request: { folder: string; path: string }): string | null
  /** Adds the paths to the index; an untracked path is added whole. */
  stage(folder: string, paths: readonly string[]): void
  /** Takes the paths back out of the index, leaving the working tree alone. */
  unstage(folder: string, paths: readonly string[]): void
  /**
   * Throws away everything uncommitted about these files: what HEAD has comes back, what HEAD
   * never had is deleted. The one action here that loses work.
   */
  discard(folder: string, files: readonly ChangedFile[]): void
  /** Commits what is staged with the boss's message. Signing is off: no window can answer for it. */
  commit(folder: string, message: string): void
  /** Pushes the branch, publishing it when it has no upstream yet. */
  push(request: { folder: string; branch: string; upstream: boolean }): void
}

export interface FileChangesOptions {
  /** The places the Files view already lists; nothing new is discovered here. */
  places(): FilePlace[]
  git?: ChangesGit
  /** How many files one place lists before it says it stopped short. */
  limit?: number
}

export interface FileChangesReader {
  /** Every place that has something changed in it, read from the cache where it is warm. */
  list(): PlaceChanges[]
  /** One place's status, cached. */
  of(placeId: string): PlaceChanges
  /** One changed file's head row and two sides, or null when git has no text for it at all. */
  diff(placeId: string, path: string): ChangedFileDiff | null
  stage(placeId: string, paths: readonly string[]): void
  unstage(placeId: string, paths: readonly string[]): void
  /** Discards the paths. Whoever calls it has already asked the boss and taken the restore point. */
  discard(placeId: string, paths: readonly string[]): void
  commit(placeId: string, message: string): void
  push(placeId: string): void
  /** Drops what is cached for one place, or for all of them. Every event the app has lands here. */
  invalidate(placeId?: string): void
}

/**
 * The Company's `git status`, one per place, cached until something the app already knows about
 * says it moved. Nothing is walked that the Company does not already list, and nothing runs on a
 * render: a read that is warm is a map lookup.
 */
export function createFileChanges({
  places,
  git = gitChanges,
  limit = CHANGES_LIMIT,
}: FileChangesOptions): FileChangesReader {
  const cache = new Map<string, PlaceChanges>()

  function placeOf(placeId: string): FilePlace {
    const place = places().find((candidate) => candidate.id === placeId)
    if (!place) throw new Error(`No repo or worktree called ${placeId} is open`)
    return place
  }

  function read(place: FilePlace): PlaceChanges {
    const cached = cache.get(place.id)
    if (cached) return cached
    const output = git.status(place.path)
    const fresh: PlaceChanges =
      output === null
        ? { placeId: place.id, files: [], branch: place.branch ?? '', ahead: 0, upstream: false, truncated: false }
        : { ...parseStatus(output, limit), placeId: place.id }
    cache.set(place.id, fresh)
    return fresh
  }

  /** Does the work, then forgets what it knew about that place: the next read asks git again. */
  function act(placeId: string, action: (place: FilePlace) => void): void {
    const place = placeOf(placeId)
    try {
      action(place)
    } finally {
      cache.delete(place.id)
    }
  }

  function filesOf(place: FilePlace, paths: readonly string[]): ChangedFile[] {
    const known = read(place).files
    return paths.map((path) => known.find((file) => file.path === path) ?? blank(path))
  }

  return {
    list: () =>
      places()
        .map(read)
        .filter((changes) => changes.files.length > 0),

    of: (placeId) => read(placeOf(placeId)),

    diff(placeId, path) {
      const place = placeOf(placeId)
      const file = filesOf(place, [path])[0]!
      // The patch is read for its counts and for whether git calls the file binary; the diff
      // itself is Monaco's to work out from the two sides below (T243).
      const patch = git.diff({ folder: place.path, path, previousPath: file.previousPath })
      const parsed = diffFilesOf(patch)
      const found = parsed.find((one) => one.path === path) ?? parsed[0] ?? null
      if (found === null) return null
      // The status is what the row was drawn from, so the head of the diff says the same thing.
      const head: DiffFile = { ...found, status: statusOf(file), previousPath: file.previousPath }
      const sides = found.binary
        ? { original: '', modified: '' }
        : {
            // A file HEAD never had has no base side, and one that was deleted has no head side.
            original:
              head.status === 'added'
                ? ''
                : (git.atHead({ folder: place.path, path: file.previousPath ?? path }) ?? ''),
            modified: head.status === 'removed' ? '' : (git.working({ folder: place.path, path }) ?? ''),
          }
      return { file: head, sides: { path, ...sides, binary: found.binary } }
    },

    stage: (placeId, paths) => act(placeId, (place) => git.stage(place.path, paths)),
    unstage: (placeId, paths) => act(placeId, (place) => git.unstage(place.path, paths)),
    discard: (placeId, paths) => act(placeId, (place) => git.discard(place.path, filesOf(place, paths))),

    commit(placeId, message) {
      const said = message.trim()
      if (!said) throw new Error('A commit needs a message.')
      act(placeId, (place) => {
        if (read(place).files.every((file) => file.staged === null)) {
          throw new Error('Nothing is staged, so there is nothing to commit.')
        }
        git.commit(place.path, said)
      })
    },

    push(placeId) {
      act(placeId, (place) => {
        const changes = read(place)
        git.push({ folder: place.path, branch: changes.branch, upstream: changes.upstream })
      })
    },

    invalidate(placeId) {
      if (placeId === undefined) cache.clear()
      else cache.delete(placeId)
    },
  }
}

/** A path git no longer reports: treated as an ordinary modification, and refused by git itself. */
function blank(path: string): ChangedFile {
  return { path, previousPath: null, staged: null, unstaged: 'modified', conflicted: false }
}

/** What the diff head calls the change, from the two sides of the index. */
function statusOf(file: ChangedFile): DiffFile['status'] {
  const mark = file.unstaged ?? file.staged ?? 'modified'
  return mark
}

/** `M`, `A`, `D`, `R` and the rest of git's one-letter codes, as one side of a change. */
function markFrom(code: string): ChangeMark | null {
  if (code === 'M' || code === 'T') return 'modified'
  if (code === 'A') return 'added'
  if (code === 'D') return 'removed'
  if (code === 'R') return 'renamed'
  // A copy is a file that was not there before, whatever git found it was copied from.
  if (code === 'C') return 'added'
  return null
}

/** The `XY` pairs git uses for a file both sides touched: it is in conflict, not merely changed. */
function isConflict(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

/**
 * `git status -z --porcelain --branch --untracked-files=all` as the tab reads it. NUL-separated,
 * so a path with a newline or a quote in it needs no unquoting: git never quotes under `-z`.
 */
export function parseStatus(output: string, limit = CHANGES_LIMIT): Omit<PlaceChanges, 'placeId'> {
  const records = output.split('\0')
  const files: ChangedFile[] = []
  let branch = ''
  let ahead = 0
  let upstream = false
  let truncated = false
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (record === '') continue
    if (record.startsWith('## ')) {
      const head = branchOf(record.slice(3))
      branch = head.branch
      ahead = head.ahead
      upstream = head.upstream
      continue
    }
    const x = record[0]!
    const y = record[1]!
    const path = record.slice(3)
    // A rename carries where it came from as the record straight after it.
    const renamed = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    const previousPath = renamed ? (records[++index] ?? null) : null
    if (files.length >= limit) {
      truncated = true
      break
    }
    if (x === '?' && y === '?') {
      files.push({ path, previousPath: null, staged: null, unstaged: 'added', conflicted: false })
      continue
    }
    // `!!` is an ignored file, which only shows when it was asked for; it is nobody's change.
    if (x === '!' && y === '!') continue
    if (isConflict(x, y)) {
      files.push({ path, previousPath, staged: null, unstaged: 'modified', conflicted: true })
      continue
    }
    files.push({ path, previousPath, staged: markFrom(x), unstaged: markFrom(y), conflicted: false })
  }
  return { files: sortFiles(files), branch, ahead, upstream, truncated }
}

/** `main...origin/main [ahead 2, behind 1]`, `main`, `HEAD (no branch)`, or no commits yet. */
function branchOf(line: string): { branch: string; ahead: number; upstream: boolean } {
  const noCommits = /^No commits yet on (.+)$/.exec(line)
  if (noCommits) return { branch: noCommits[1]!.trim(), ahead: 0, upstream: false }
  const ahead = /\[.*?ahead (\d+)/.exec(line)
  const withoutCounts = line.replace(/\s*\[.*\]\s*$/, '')
  const [head, tracked] = withoutCounts.split('...')
  return {
    branch: (head ?? '').trim(),
    ahead: ahead ? Number(ahead[1]) : 0,
    upstream: Boolean(tracked && tracked.trim()),
  }
}

/** Folder by folder, then by name: the same order the tree puts a place's files in. */
function sortFiles(files: ChangedFile[]): ChangedFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * No `mapPaths` anywhere below, and that is the rule: every one of these reads a patch, a file or
 * `git status`'s repo-relative names, and the only absolute paths in any of them belong to somebody's
 * source code (T259).
 */
function run(git: GitRunner, cwd: string, args: string[], buffer = 1024 * 1024): string {
  return git.text(cwd, args, { maxBuffer: buffer })
}

function tryRun(git: GitRunner, cwd: string, args: string[], buffer = 1024 * 1024): string | null {
  return git.tryText(cwd, args, { maxBuffer: buffer })
}

/**
 * What git wrote, whatever it exited with. `git diff --no-index` exits 1 exactly when it has a
 * patch to show, so a diff read that threw away non-zero exits would throw away every new file.
 */
function output(git: GitRunner, cwd: string, args: string[], buffer = 1024 * 1024): string {
  try {
    return run(git, cwd, args, buffer)
  } catch (error) {
    const wrote = (error as { stdout?: string | Buffer }).stdout
    return typeof wrote === 'string' ? wrote : (wrote?.toString('utf8') ?? '')
  }
}

/**
 * Flags for a commit the app runs on the boss's behalf. Signing is off: `commit.gpgsign` would ask
 * for a passphrase no window can answer, and the commit would hang instead of failing.
 */
const NO_SIGNING = ['-c', 'commit.gpgsign=false']

/**
 * The real thing: what `git` says, and what it does when the boss clicks.
 *
 * A factory rather than a `const`, because which git answers is a fact about the folder now (T259):
 * a place inside a distro is staged, committed and pushed by the distro's own git, so the commit
 * carries the identity that distro is configured with rather than Windows's.
 */
export function createGitChanges(git: GitRunner = createGitRunner()): ChangesGit {
  return {
    status(folder) {
      return tryRun(git, folder, ['status', '-z', '--porcelain', '--branch', '--untracked-files=all'], DIFF_BUFFER)
    },

    atHead({ folder, path }) {
      return tryRun(git, folder, ['show', `HEAD:${path}`], DIFF_BUFFER)
    },

    working({ folder, path }) {
      try {
        return readFileSync(join(folder, path), 'utf8')
      } catch {
        return null
      }
    },

    diff({ folder, path, previousPath }) {
      // HEAD, not the index: one diff carries what is staged and what is not, as the row does.
      const paths = previousPath === null ? [path] : [path, previousPath]
      const tracked = tryRun(git, folder, ['diff', 'HEAD', '--', ...paths], DIFF_BUFFER)
      if (tracked) return tracked
      // A file git has never seen has no `git diff`; against nothing it has one.
      return output(git, folder, ['diff', '--no-index', '--', '/dev/null', path], DIFF_BUFFER)
    },

    stage(folder, paths) {
      if (paths.length === 0) return
      run(git, folder, ['add', '--', ...paths])
    },

    unstage(folder, paths) {
      if (paths.length === 0) return
      // A repo with no commit yet has no HEAD to reset against; `git rm --cached` is the same move.
      if (tryRun(git, folder, ['rev-parse', '--verify', '--quiet', 'HEAD']) === null) {
        run(git, folder, ['rm', '--cached', '-r', '--', ...paths])
        return
      }
      run(git, folder, ['reset', '--quiet', 'HEAD', '--', ...paths])
    },

    discard(folder, files) {
      if (files.length === 0) return
      const paths = [
        ...new Set(files.flatMap((file) => [file.path, file.previousPath].filter((p): p is string => !!p))),
      ]
      const hasHead = tryRun(git, folder, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null
      // Nothing about these paths stays in the index: a rename is undone from both of its names.
      if (hasHead) tryRun(git, folder, ['reset', '--quiet', 'HEAD', '--', ...paths])
      const inHead = hasHead
        ? (tryRun(git, folder, ['ls-tree', '-z', '--name-only', 'HEAD', '--', ...paths]) ?? '')
            .split('\0')
            .filter(Boolean)
        : []
      if (inHead.length > 0) run(git, folder, ['checkout', '--quiet', 'HEAD', '--', ...inHead])
      const never = paths.filter((path) => !inHead.includes(path))
      // What HEAD never had cannot be checked out: it is deleted, which is what discarding it means.
      if (never.length > 0) run(git, folder, ['clean', '--quiet', '-f', '-d', '--', ...never])
    },

    commit(folder, message) {
      run(git, folder, [...NO_SIGNING, 'commit', '--message', message])
    },

    push({ folder, branch, upstream }) {
      if (upstream) run(git, folder, ['push'], DIFF_BUFFER)
      else run(git, folder, ['push', '--set-upstream', 'origin', branch], DIFF_BUFFER)
    },
  }
}

/** The Changes tab's git for a caller with no runner of its own. */
export const gitChanges: ChangesGit = createGitChanges()
