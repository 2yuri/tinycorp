import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { PAGE_FOLDERS } from './company-memory-page'

/**
 * The Company memory's files. Every page is a `.md` file under the memory folder, and this is the
 * only way the store touches them — so a test can hold them in a map and the store stays the same
 * code that writes the real folder.
 *
 * A page is named by a POSIX key — `decisions/locale-handling-in-billing.md` — everywhere above
 * this layer: it is what the index stores, what git is given and what the screen shows, and it
 * reads the same on macOS, Windows and Linux. Turning one into a path on this machine happens
 * here, and only here, through `node:path`.
 */
export interface MemoryPageFiles {
  /** Where the pages are, for the boss's Open in Files and for git. */
  folder: string
  /** Every `.md` file, as POSIX paths relative to the folder, in a stable order. */
  list(): string[]
  read(relative: string): string | null
  write(relative: string, content: string): void
  /** Moves a page, e.g. into `archive/`. Does nothing when the source is gone. */
  move(from: string, to: string): void
  remove(relative: string): void
}

/** Pages on disk under `<company folder>/memory/company`. */
export function memoryPageFilesOnDisk(folder: string): MemoryPageFiles {
  function ensure(): void {
    for (const name of PAGE_FOLDERS) mkdirSync(join(folder, name), { recursive: true })
  }
  return {
    folder,
    list() {
      if (!existsSync(folder)) return []
      const found: string[] = []
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name === '.git') continue
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (entry.name.endsWith('.md')) found.push(relative(folder, path).split(sep).join('/'))
        }
      }
      walk(folder)
      return found
    },
    read(name) {
      try {
        return readFileSync(join(folder, name), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    write(name, content) {
      ensure()
      const file = join(folder, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    },
    move(from, to) {
      const source = join(folder, from)
      if (!existsSync(source)) return
      const target = join(folder, to)
      mkdirSync(dirname(target), { recursive: true })
      // Windows refuses a rename onto a file that is already there, where POSIX replaces it; a
      // page archived, written again and archived again must behave the same on all three.
      rmSync(target, { force: true })
      renameSync(source, target)
    },
    remove(name) {
      rmSync(join(folder, name), { force: true })
    },
  }
}

/** Pages held in a map, for tests that are about the store and not about a disk. */
export function inMemoryPageFiles(folder = '/company/memory/company'): MemoryPageFiles {
  const files = new Map<string, string>()
  return {
    folder,
    list: () => [...files.keys()].sort(),
    read: (name) => files.get(name) ?? null,
    write(name, content) {
      files.set(name, content)
    },
    move(from, to) {
      const content = files.get(from)
      if (content === undefined) return
      files.delete(from)
      files.set(to, content)
    },
    remove(name) {
      files.delete(name)
    },
  }
}
