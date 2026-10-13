import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The disk under an Employee's notes (T193).
 *
 * A log that may be a hundred megabytes is not read with `readFileSync`, so this seam sits lower
 * than `MemoryFiles`: a size, a read of a byte range, an append. Everything above it — the log,
 * the summary tree, the wake — is plain data over these seven calls, which is why every test but
 * the generated-million one runs in memory.
 */
export interface NotesFiles {
  /** Bytes the file holds, or 0 when it is not there. */
  size(path: string): number
  /** `length` bytes from `start`. Shorter than asked for at the end of the file. */
  readAt(path: string, start: number, length: number): Buffer
  /** The whole file, or null when it is not there. For the tree's small files and the migration. */
  read(path: string): string | null
  /** Appends, making the folder when it is not there yet. */
  append(path: string, text: string): void
  write(path: string, text: string): void
  /** Removes one file. Nothing happens when it is not there. */
  remove(path: string): void
  /** The file names in a folder, or `[]` when there is no such folder. */
  list(folder: string): string[]
  /** Renames, making the target's folder when it is not there. */
  rename(from: string, to: string): void
}

/** The Employee's own folder: `<company folder>/memory/<employee id>/`. */
export function notesFolder(companyFolder: string, employeeId: string): string {
  return join(companyFolder, 'memory', employeeId)
}

/** The log itself: one note per line, appended to and never rewritten. */
export function notesLogPath(companyFolder: string, employeeId: string): string {
  return join(notesFolder(companyFolder, employeeId), 'log')
}

/** The summaries, a cache that can always be thrown away and written again from the log. */
export function notesTreeFolder(companyFolder: string, employeeId: string): string {
  return join(notesFolder(companyFolder, employeeId), 'tree')
}

/** The file T73 kept, which T193 reads once and moves aside as `<id>.md.bak`. */
export function legacyNotesPath(companyFolder: string, employeeId: string): string {
  return join(companyFolder, 'memory', `${employeeId}.md`)
}

/** Real files, under the Company folder. */
export const notesFilesOnDisk: NotesFiles = {
  size(path) {
    try {
      return statSync(path).size
    } catch (error) {
      if (missing(error)) return 0
      throw error
    }
  },
  readAt(path, start, length) {
    if (length <= 0) return EMPTY
    let handle: number
    try {
      handle = openSync(path, 'r')
    } catch (error) {
      if (missing(error)) return EMPTY
      throw error
    }
    try {
      const buffer = Buffer.alloc(length)
      const read = readSync(handle, buffer, 0, length, start)
      return read === length ? buffer : buffer.subarray(0, read)
    } finally {
      closeSync(handle)
    }
  },
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  },
  append(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, text)
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  },
  remove(path) {
    rmSync(path, { force: true })
  },
  list(folder) {
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    } catch (error) {
      // A tree nobody has written yet is the ordinary case, not a failure.
      if (missing(error)) return []
      throw error
    }
  },
  rename(from, to) {
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
  },
}

const EMPTY = Buffer.alloc(0)

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}
