import { readdir, readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import {
  type FoundKind,
  type FoundRepo,
  type FoundReposWalk,
  WALK_BUDGET_MS,
  WALK_DEPTH,
  type WalkStop,
} from '../../../shared/repos/found-repos'

/** One entry of a folder, as the walk needs it. A symlink is never followed. */
export interface WalkEntry {
  name: string
  folder: boolean
  symlink: boolean
}

/** What the walk may read. Nothing here writes, and nothing here throws. */
export interface WalkDeps {
  /** The entries of a folder; empty when it cannot be read. */
  entries(path: string): Promise<WalkEntry[]>
  /** The text of a `.git` file; null when it cannot be read. */
  readGitFile(path: string): Promise<string | null>
  now(): number
}

export const diskWalkDeps: WalkDeps = {
  async entries(path) {
    try {
      const found = await readdir(path, { withFileTypes: true })
      return found.map((entry) => ({
        name: entry.name,
        folder: entry.isDirectory(),
        symlink: entry.isSymbolicLink(),
      }))
    } catch {
      return []
    }
  },
  async readGitFile(path) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  },
  now: () => Date.now(),
}

/**
 * Folders the walk never enters, on top of every dot-folder — which is also what keeps it out of a
 * repo's own `.git`. Build output and vendored dependencies hold checkouts nobody meant to connect.
 */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  'node_modules',
  'vendor',
  '.venv',
  'target',
  'dist',
  'build',
  'Pods',
])

export interface WalkOptions {
  /** How far below the picked folder to look; {@link WALK_DEPTH} by default. */
  depth?: number
  /** About how long the walk may run; {@link WALK_BUDGET_MS} by default. */
  budgetMs?: number
  /** Asked before every folder: true stops the walk and reports what it has. */
  cancelled?(): boolean
  /** Every checkout, the moment it is found, so rows can stream into the list. */
  onFound?(found: FoundRepo): void
  /** Where the walk is, below the picked folder, and how many it has found. */
  onProgress?(at: string, total: number): void
}

/**
 * The checkouts in `root` and up to `depth` levels below it, breadth-first, so the shallow ones
 * arrive first. It reads and nothing else: no `.git` is written, no file is touched.
 *
 * A `.git` folder is a repo, and the walk keeps going *through* it, because repos nest. A `.git`
 * file is a worktree or a submodule — both are shown and neither is offered, since adding one would
 * attach the same history twice. It follows no symlink, enters none of {@link SKIPPED_FOLDERS} nor
 * any dot-folder, and gives up after its time box rather than holding the boss at a spinner.
 */
export async function walkForRepos(root: string, deps: WalkDeps, options: WalkOptions = {}): Promise<FoundReposWalk> {
  if (!isAbsolute(root)) throw new Error(`A folder to walk must be absolute: ${root}`)
  const folder = resolve(root)
  const depth = options.depth ?? WALK_DEPTH
  const budget = options.budgetMs ?? WALK_BUDGET_MS
  const started = deps.now()

  const found: FoundRepo[] = []
  /** The folders directly below the picked one that the walk entered, to count the empty ones. */
  const topFolders = new Set<string>()
  let queue: { path: string; relative: string; level: number }[] = [{ path: folder, relative: '', level: 0 }]

  while (queue.length > 0) {
    const next: typeof queue = []
    for (const { path, relative, level } of queue) {
      if (options.cancelled?.()) return ended('cancelled')
      if (deps.now() - started > budget) return ended('timed-out')
      options.onProgress?.(relative, found.length)

      const entries = await deps.entries(path)
      const git = entries.find((entry) => entry.name === '.git' && !entry.symlink)
      if (git) {
        const checkout = await readCheckout(path, relative, git, deps)
        found.push(checkout)
        options.onFound?.(checkout)
      }
      if (level >= depth) continue
      for (const entry of entries) {
        if (!entry.folder || entry.symlink) continue
        if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name)) continue
        if (level === 0) topFolders.add(entry.name)
        next.push({
          path: join(path, entry.name),
          relative: relative ? `${relative}/${entry.name}` : entry.name,
          level: level + 1,
        })
      }
    }
    queue = next
  }
  return ended('done')

  function ended(stopped: WalkStop): FoundReposWalk {
    const withCheckouts = new Set(found.map((one) => one.relative.split('/')[0]))
    return {
      folder,
      found,
      stopped,
      emptyFolders: [...topFolders].filter((name) => !withCheckouts.has(name)).length,
    }
  }
}

async function readCheckout(path: string, relative: string, git: WalkEntry, deps: WalkDeps): Promise<FoundRepo> {
  if (git.folder) return { path, relative, kind: 'repo', parent: null }
  const gitdir = readGitdir(await deps.readGitFile(join(path, '.git')))
  return { path, relative, ...linkedTo(path, gitdir) }
}

function readGitdir(file: string | null): string {
  return /^\s*gitdir:\s*(.+?)\s*$/m.exec(file ?? '')?.[1] ?? ''
}

/**
 * What a `.git` file points at: `…/<repo>/.git/worktrees/<name>` is a worktree of `<repo>` and
 * `…/<repo>/.git/modules/<name>` a submodule of it. Anything else is read as a repo of its own,
 * because a `.git` file with no gitdir we understand is still somebody's checkout.
 */
function linkedTo(path: string, gitdir: string): { kind: FoundKind; parent: string | null } {
  if (!gitdir) return { kind: 'repo', parent: null }
  const absolute = isAbsolute(gitdir) ? gitdir : resolve(path, gitdir)
  const split = /^(.*)[\\/]\.git[\\/](worktrees|modules)[\\/]/.exec(absolute)
  if (!split) return { kind: 'repo', parent: null }
  const parent = basename(split[1]!)
  return { kind: split[2] === 'worktrees' ? 'worktree' : 'submodule', parent: parent || null }
}
