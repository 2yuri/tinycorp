import { closeSync, type Dirent, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Worktree } from '../../../shared/code'
import type { FileSaveRequest, FileSaveResult } from '../../../shared/files/file-edits'
import {
  extensionOf,
  type FileChange,
  type FileEntry,
  type FilePlace,
  type FileTree,
  IMAGE_EXTENSIONS,
  LANGUAGE_BY_EXTENSION,
  type OpenedFile,
  placeId,
} from '../../../shared/files/files'
import { createGitRunner, type GitRunner } from '../../platform'
import { changedUnderneath, createInside, digestOf, refuseGitPath, refuseNewPath, writeInside } from './file-writes'

/** How much of a file's text the viewer ever gets; the rest is left out and said to be. */
export const HEAD_BYTES = 256 * 1024
/** Beyond this nothing is read at all: the viewer says so and hands the boss their own tools. */
export const TOO_BIG_BYTES = 8 * 1024 * 1024
/** How many nodes one place's tree may hold before the walk stops. */
export const TREE_LIMIT = 4000
/** Never walked: the one git keeps and the one nobody wrote. */
export const SKIPPED_FOLDERS = ['.git', 'node_modules']

/** What reading files needs of git; injected so tests need no checkout. */
export interface FilesDeps {
  /** What an Employee changed in a worktree against `base`, by path relative to the worktree. */
  changes(request: { folder: string; base: string }): Record<string, FileChange>
  /** The numbers of the lines they changed in one file, as that file numbers them now. */
  changedLines(request: { folder: string; base: string; path: string }): number[]
}

export interface FilesOptions {
  /** The repos and worktrees of the current Company. Throws when no Company is open. */
  places(): FilePlace[]
  deps?: FilesDeps
}

export interface FilesReader {
  places(): FilePlace[]
  /** The place's folders and files, marked with what the Employee changed. */
  tree(id: string): FileTree
  /** One file of the place, opened by kind. */
  open(id: string, path: string): OpenedFile
  /**
   * The absolute path of a file in a place — or of the place itself with no path — for the boss's
   * own tools. Refuses anything that climbs out of the place.
   */
  locate(id: string, path?: string): string
  /**
   * Writes the boss's text back to a file of the place (T122). A file that changed underneath
   * since it was opened is not overwritten: both versions come back instead.
   */
  save(id: string, request: FileSaveRequest): FileSaveResult
  /** Makes an empty file inside the place and opens it. Refuses a name the place already has. */
  create(id: string, path: string): OpenedFile
}

/** Every place the Files view can open: each connected repo, and each ticket worktree of one. */
/** Everything a place list is made of: the Company's repos, worktrees, tickets and roster. */
export interface FilePlacesInput {
  repos: readonly { id: string; name: string; path: string }[]
  worktrees: readonly Worktree[]
  tickets: readonly { id: number; title: string; assigneeId: string | null }[]
  employees: readonly { id: string; name: string }[]
  companyKey: string
  /** Whose Session is running right now, by Employee id; a worktree of theirs says so (T122). */
  running?: (employeeId: string) => boolean
}

export function filePlaces(input: FilePlacesInput): FilePlace[] {
  const repoById = new Map(input.repos.map((repo) => [repo.id, repo]))
  const repos = input.repos.map(
    (repo): FilePlace => ({
      id: placeId(repo.id, null),
      repoId: repo.id,
      repoName: repo.name,
      path: repo.path,
      ticketId: null,
      ticketKey: null,
      ticketTitle: null,
      holderName: null,
      branch: null,
      base: null,
      sessionRunning: false,
    }),
  )
  const worktrees = input.worktrees.flatMap((worktree): FilePlace[] => {
    const repo = repoById.get(worktree.repoId)
    if (!repo) return []
    const ticket = input.tickets.find((t) => t.id === worktree.ticketId) ?? null
    const holder = ticket?.assigneeId ? (input.employees.find((e) => e.id === ticket.assigneeId) ?? null) : null
    return [
      {
        id: placeId(worktree.repoId, worktree.ticketId),
        repoId: repo.id,
        repoName: repo.name,
        path: worktree.path,
        ticketId: worktree.ticketId,
        ticketKey: `${input.companyKey}-${worktree.ticketId}`,
        ticketTitle: ticket?.title ?? null,
        holderName: holder?.name ?? null,
        branch: worktree.branch,
        base: worktree.base,
        sessionRunning: holder ? (input.running?.(holder.id) ?? false) : false,
      },
    ]
  })
  // An Employee's worktree first: it is what the view is for.
  return [...worktrees, ...repos]
}

/**
 * Reads the Company's own repos and worktrees for the Files view. Every path is checked against
 * the place it claims to be in: one that climbs out is refused before anything is opened.
 */
export function createFiles({ places, deps = gitFilesDeps }: FilesOptions): FilesReader {
  function placeOf(id: string): FilePlace {
    const place = places().find((candidate) => candidate.id === id)
    if (!place) throw new Error(`No repo or worktree called ${id} is open`)
    return place
  }

  function changesOf(place: FilePlace): Record<string, FileChange> {
    if (place.ticketId === null || !place.base) return {}
    return deps.changes({ folder: place.path, base: place.base })
  }

  return {
    places,

    tree(id) {
      const place = placeOf(id)
      const changes = changesOf(place)
      const { entries, truncated } = walk(place.path)
      const marked = entries.map(
        (entry): FileEntry => ({ ...entry, change: entry.kind === 'file' ? (changes[entry.path] ?? null) : null }),
      )
      // A file the Employee deleted is gone from disk but is still theirs to see marked.
      const removed = Object.entries(changes)
        .filter(([path, change]) => change === 'removed' && !marked.some((entry) => entry.path === path))
        .map(([path]): FileEntry => ({ path, kind: 'file', change: 'removed' }))
      return { placeId: place.id, entries: sortEntries([...marked, ...removed]), truncated }
    },

    open(id, path) {
      const place = placeOf(id)
      return openIn(place, resolveInside(place.path, path))
    },

    locate(id, path) {
      const place = placeOf(id)
      return path === undefined || path === '' ? realOrResolved(place.path) : resolveInside(place.path, path)
    },

    save(id, request) {
      const place = placeOf(id)
      const full = resolveInside(place.path, request.path)
      refuseGitPath(normalise(place.path, full))
      const theirs = changedUnderneath(full, request.digest)
      // Nothing is overwritten by surprise: whoever wrote it keeps their text until the boss picks.
      if (theirs) {
        return {
          saved: false,
          conflict: {
            path: normalise(place.path, full),
            theirs: theirs.text,
            theirDigest: theirs.digest,
            yours: request.text,
          },
        }
      }
      writeInside(full, request.text)
      return { saved: true, file: openIn(place, full) }
    },

    create(id, path) {
      const place = placeOf(id)
      refuseNewPath(path)
      const full = resolveInside(place.path, path)
      const inside = normalise(place.path, full)
      refuseGitPath(inside)
      createInside(full, inside)
      return openIn(place, full)
    },
  }

  /** One file of the place by its absolute path, marked with what the Employee did to it. */
  function openIn(place: FilePlace, full: string): OpenedFile {
    const inside = normalise(place.path, full)
    return openFile({
      full,
      path: inside,
      change: changesOf(place)[inside] ?? null,
      changedLines: () =>
        place.ticketId === null || !place.base
          ? []
          : deps.changedLines({ folder: place.path, base: place.base, path: inside }),
    })
  }
}

/**
 * Where `path` lands inside `root`, refusing anything outside it — `..`, an absolute path, or a
 * symlink that points away. The real path of the nearest folder that exists is what is compared,
 * so a link cannot smuggle the reader out of the place.
 */
export function resolveInside(root: string, path: string): string {
  const base = realOrResolved(root)
  const full = resolve(base, path)
  const real = realOrResolved(full)
  if (real !== base && !real.startsWith(base + sep)) throw new Error(`${path} is outside the place it claims to be in`)
  return full
}

/** The path with every symlink followed, as far as the parts that exist allow. */
function realOrResolved(path: string): string {
  const full = resolve(path)
  for (let candidate = full; ; candidate = dirname(candidate)) {
    try {
      return join(realpathSync(candidate), relative(candidate, full))
    } catch {
      if (dirname(candidate) === candidate) return full
    }
  }
}

function normalise(root: string, full: string): string {
  return relative(realOrResolved(root), realOrResolved(full)).split(sep).join('/')
}

/** Folders before files, each level in alphabetical order, parents before their children. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    const left = a.path.split('/')
    const right = b.path.split('/')
    for (let depth = 0; depth < Math.max(left.length, right.length); depth++) {
      const one = left[depth]
      const other = right[depth]
      if (one === undefined) return -1
      if (other === undefined) return 1
      if (one !== other) {
        const oneIsFolder = depth < left.length - 1 || a.kind === 'folder'
        const otherIsFolder = depth < right.length - 1 || b.kind === 'folder'
        if (oneIsFolder !== otherIsFolder) return oneIsFolder ? -1 : 1
        return one.localeCompare(other)
      }
    }
    return 0
  })
}

/** Every folder and file under `root`, skipping what nobody authored, up to `TREE_LIMIT` nodes. */
function walk(root: string): { entries: FileEntry[]; truncated: boolean } {
  const entries: FileEntry[] = []
  let truncated = false
  const queue: string[] = ['']
  while (queue.length > 0) {
    const folder = queue.shift()!
    let read: Dirent[]
    try {
      read = readdirSync(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of read) {
      if (SKIPPED_FOLDERS.includes(child.name)) continue
      if (entries.length >= TREE_LIMIT) {
        truncated = true
        return { entries, truncated }
      }
      const path = folder ? `${folder}/${child.name}` : child.name
      // A symlink is shown as the file it is, never followed: following one could leave the place.
      const isFolder = child.isDirectory()
      entries.push({ path, kind: isFolder ? 'folder' : 'file', change: null })
      if (isFolder) queue.push(path)
    }
  }
  return { entries, truncated }
}

/**
 * Reads one file by its absolute path, for a reader that owns no place: a path an Employee wrote
 * that lands outside the Company (T114). Nothing is changed here either — it only reads.
 */
export function openFileAt(full: string): OpenedFile {
  return openFile({ full, path: full, change: null, changedLines: () => [] })
}

/** Reads one file: its kind decides what comes back, and how much of it. */
function openFile({
  full,
  path,
  change,
  changedLines,
}: {
  full: string
  path: string
  change: FileChange | null
  changedLines: () => number[]
}): OpenedFile {
  const blank: OpenedFile = {
    path,
    kind: 'text',
    size: 0,
    text: null,
    truncated: false,
    lines: null,
    dataUrl: null,
    language: null,
    changedLines: [],
    change,
    digest: null,
  }
  const stats = statSync(full)
  if (stats.isDirectory()) throw new Error(`${path} is a folder, not a file`)
  const size = stats.size
  const extension = extensionOf(path)
  const image = (IMAGE_EXTENSIONS as readonly string[]).includes(extension)
  if (size > TOO_BIG_BYTES) return { ...blank, kind: 'too-big', size }
  const head = readHead(full, image ? size : Math.min(size, HEAD_BYTES))
  // What the boss opened, to be checked against the file on disk when they save it back (T122).
  const digest = digestOf(head)
  if (image) return { ...blank, kind: 'image', size, dataUrl: dataUrl(extension, head), digest }
  if (head.includes(0)) return { ...blank, kind: 'binary', size, digest }
  const text = head.toString('utf8')
  const language = LANGUAGE_BY_EXTENSION[extension] ?? null
  const markdown = extension === 'md' || extension === 'markdown'
  return {
    ...blank,
    kind: markdown ? 'markdown' : language ? 'code' : 'text',
    size,
    text,
    truncated: size > head.length,
    // As the viewer draws them: the newline a file ends with does not make a line of its own.
    lines: text === '' ? 0 : text.replace(/\n$/, '').split('\n').length,
    language,
    changedLines: changedLines(),
    digest,
  }
}

function readHead(path: string, bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes)
  const handle = openSync(path, 'r')
  try {
    const read = readSync(handle, buffer, 0, bytes, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(handle)
  }
}

/** The media type each image extension is served as, in a data URL. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

function dataUrl(extension: string, bytes: Buffer): string {
  return `data:${IMAGE_TYPES[extension] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`
}

/** The head-side line numbers of a `git diff --unified=0` patch, from its `@@` headers alone. */
export function changedLinesOf(patch: string): number[] {
  const lines: number[] = []
  for (const [, start, count] of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(start)
    const many = count === undefined ? 1 : Number(count)
    for (let line = from; line < from + many; line++) lines.push(line)
  }
  return lines
}

/** `git diff --name-status` output as the tree's marks, the new path of a rename counting as added. */
export function changesOfNameStatus(output: string): Record<string, FileChange> {
  const changes: Record<string, FileChange> = {}
  for (const line of output.split('\n')) {
    const parts = line.split('\t')
    const status = parts[0]?.[0]
    if (!status || parts.length < 2) continue
    const path = (parts.length > 2 ? parts[2] : parts[1])!
    if (status === 'D') changes[path] = 'removed'
    else if (status === 'A' || status === 'R' || status === 'C') changes[path] = 'added'
    else changes[path] = 'modified'
  }
  return changes
}

/** The real thing: what `git` says the Employee changed in their worktree. Never throws. */
export const gitFilesDeps: FilesDeps = {
  changes({ folder, base }) {
    const tracked = changesOfNameStatus(diff(folder, base, ['--name-status']) ?? '')
    for (const path of (tryGit(folder, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n')) {
      if (path) tracked[path] ??= 'added'
    }
    return tracked
  },
  changedLines({ folder, base, path }) {
    return changedLinesOf(diff(folder, base, ['--unified=0', '--', path]) ?? '')
  },
}

/**
 * The worktree against where its branch left `base`, so what comes back is the Employee's own
 * change, committed or not. A base that is not fetched falls back to `origin/`, then to what they
 * have not committed yet.
 */
function diff(cwd: string, base: string, args: string[]): string | null {
  for (const from of [base, `origin/${base}`]) {
    const patch = tryGit(cwd, ['diff', '--merge-base', from, ...args])
    if (patch !== null) return patch
  }
  return tryGit(cwd, ['diff', 'HEAD', ...args])
}

/**
 * A patch, so **no** `mapPaths`: what comes back is git's own `--name-status` and `@@` headers over
 * repo-relative paths, and the one absolute path a patch can hold is inside somebody's source (T259).
 */
function tryGit(cwd: string, args: string[], git: GitRunner = createGitRunner()): string | null {
  return git.tryText(cwd, args, { maxBuffer: 16 * 1024 * 1024 })
}
