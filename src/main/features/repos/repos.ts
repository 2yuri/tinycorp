import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  type AddRepoInput,
  type AttachScannedResult,
  DEFAULT_RUNG,
  EMPTY_STACK,
  isRepoRung,
  type Repo,
  type RepoRung,
  STACK_KEYS,
  type StackConstraints,
  type UpdateRepoInput,
} from '../../../shared/repos/repo'
import type { Migration } from '../../core'

/** Git repos attached to the current Company, each with its brief and optional Checks. */
export interface RepoRegistry {
  /** Repos in the order they were added. */
  list(): Repo[]
  add(input: AddRepoInput): Repo
  /**
   * Adds several repos on one commit (T168): picking a folder of 110 checkouts and ticking 23 of
   * them is one call and one transaction, never 23. Each one gets exactly what a single `add`
   * gives it. One that refuses — a path already attached, a folder that is no longer a checkout —
   * is reported with its reason and takes none of the others down with it.
   */
  addMany(inputs: readonly AddRepoInput[]): AttachScannedResult
  update(id: string, changes: UpdateRepoInput): Repo
  remove(id: string): void
}

/** Tells whether a folder is a git checkout (a repo or a worktree). */
export type IsGitRepo = (path: string) => boolean

export const isGitRepoOnDisk: IsGitRepo = (path) => existsSync(join(path, '.git'))

export const REPOS_MIGRATION: Migration = {
  name: 'repos-table',
  sql: `CREATE TABLE repo (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    framework TEXT NOT NULL,
    package_manager TEXT NOT NULL,
    added_at TEXT NOT NULL
  )`,
}

/** The stack commands and the package manager version; old repos start with none of them. */
export const REPOS_STACK_COMMANDS_MIGRATION: Migration = {
  name: 'repos-stack-commands',
  sql: `
  ALTER TABLE repo ADD COLUMN package_manager_version TEXT NOT NULL DEFAULT '';
  ALTER TABLE repo ADD COLUMN install_command TEXT NOT NULL DEFAULT '';
  ALTER TABLE repo ADD COLUMN build_command TEXT NOT NULL DEFAULT '';
  ALTER TABLE repo ADD COLUMN test_command TEXT NOT NULL DEFAULT '';
  ALTER TABLE repo ADD COLUMN lint_command TEXT NOT NULL DEFAULT '';
`,
}

/** Decision 40: every repo gets a free-text brief; existing repos keep their stack as Checks. */
export const REPOS_BRIEF_MIGRATION: Migration = {
  name: 'repo-brief',
  sql: `ALTER TABLE repo ADD COLUMN brief TEXT NOT NULL DEFAULT ''`,
}

/**
 * Decision 61: what TinyCorp may do to the repo. Every repo already attached keeps what it had,
 * which is `merge`, so nothing changes for a Company that never touches this.
 */
export const REPOS_RUNG_MIGRATION: Migration = {
  name: 'repo-rung',
  sql: `ALTER TABLE repo ADD COLUMN rung TEXT NOT NULL DEFAULT 'merge'`,
}

interface RepoRow {
  id: string
  name: string
  path: string
  language: string
  framework: string
  package_manager: string
  package_manager_version: string
  install_command: string
  build_command: string
  test_command: string
  lint_command: string
  brief: string
  rung: string
  added_at: string
}

export function createRepoRegistry({
  database,
  isGitRepo,
}: {
  /** The current Company's database. Throws when no Company is open. */
  database(): DatabaseSync
  isGitRepo: IsGitRepo
}): RepoRegistry {
  function all(db: DatabaseSync): Repo[] {
    const rows = db.prepare('SELECT * FROM repo ORDER BY added_at, rowid').all() as unknown as RepoRow[]
    return rows.map(fromRow)
  }

  function refuseClash(db: DatabaseSync, repo: Pick<Repo, 'id' | 'name' | 'path'>): void {
    for (const other of all(db)) {
      if (other.id === repo.id) continue
      if (other.path === repo.path) throw new Error(`${repo.path} is already attached`)
      if (other.name === repo.name) throw new Error(`A repo named ${repo.name} already exists`)
    }
  }

  function save(db: DatabaseSync, repo: Repo): void {
    db.prepare(
      `INSERT INTO repo (id, name, path, language, framework, package_manager, package_manager_version,
         install_command, build_command, test_command, lint_command, brief, rung, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         language = excluded.language,
         framework = excluded.framework,
         package_manager = excluded.package_manager,
         package_manager_version = excluded.package_manager_version,
         install_command = excluded.install_command,
         build_command = excluded.build_command,
         test_command = excluded.test_command,
         lint_command = excluded.lint_command,
         brief = excluded.brief,
         rung = excluded.rung`,
    ).run(
      repo.id,
      repo.name,
      repo.path,
      repo.stack.language,
      repo.stack.framework,
      repo.stack.packageManager,
      repo.stack.packageManagerVersion,
      repo.stack.install,
      repo.stack.build,
      repo.stack.test,
      repo.stack.lint,
      repo.brief,
      repo.rung,
      repo.addedAt,
    )
  }

  function find(db: DatabaseSync, id: string): Repo {
    const repo = all(db).find((r) => r.id === id)
    if (!repo) throw new Error(`Unknown repo: ${id}`)
    return repo
  }

  function addTo(db: DatabaseSync, input: AddRepoInput): Repo {
    if (!isAbsolute(input.path)) throw new Error(`A repo path must be absolute: ${input.path}`)
    const path = resolve(input.path)
    if (!isGitRepo(path)) throw new Error(`${path} is not a git repo`)
    const repo: Repo = {
      id: randomUUID(),
      name: requireName(input.name ?? basename(path)),
      path,
      brief: readBrief(input.brief) ?? '',
      stack: readStack(EMPTY_STACK, input.stack),
      rung: readRung(input.rung) ?? DEFAULT_RUNG,
      addedAt: new Date().toISOString(),
    }
    refuseClash(db, repo)
    save(db, repo)
    return repo
  }

  return {
    list: () => all(database()),

    add: (input) => addTo(database(), input),

    addMany(inputs) {
      const db = database()
      const result: AttachScannedResult = { attached: [], failed: [] }
      db.exec('BEGIN')
      try {
        for (const input of inputs) {
          try {
            result.attached.push(addTo(db, input))
          } catch (caught) {
            result.failed.push({ path: input.path, error: caught instanceof Error ? caught.message : String(caught) })
          }
        }
        db.exec('COMMIT')
      } catch (caught) {
        db.exec('ROLLBACK')
        throw caught
      }
      return result
    },

    update(id, changes) {
      const db = database()
      const current = find(db, id)
      const repo: Repo = {
        ...current,
        name: changes.name === undefined ? current.name : requireName(changes.name),
        brief: readBrief(changes.brief) ?? current.brief,
        stack: readStack(current.stack, changes.stack),
        rung: readRung(changes.rung) ?? current.rung,
      }
      refuseClash(db, repo)
      save(db, repo)
      return repo
    },

    remove(id) {
      const db = database()
      find(db, id)
      db.prepare('DELETE FROM repo WHERE id = ?').run(id)
    },
  }
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A repo needs a name')
  return trimmed
}

function readBrief(brief: unknown): string | undefined {
  if (brief === undefined) return undefined
  if (typeof brief !== 'string') throw new Error('A repo brief must be text')
  return brief.trim()
}

function readRung(rung: unknown): RepoRung | undefined {
  if (rung === undefined) return undefined
  if (!isRepoRung(rung)) throw new Error(`Unknown repo rung: ${String(rung)}`)
  return rung
}

/** `base` with the given fields applied, trimmed. An empty value clears a field. */
function readStack(base: StackConstraints, changes: Partial<StackConstraints> = {}): StackConstraints {
  const result = { ...base }
  for (const field of STACK_KEYS) {
    const value: unknown = changes[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`A repo stack ${field} must be text`)
    result[field] = value.trim()
  }
  return result
}

function fromRow(row: RepoRow): Repo {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    brief: row.brief ?? '',
    rung: isRepoRung(row.rung) ? row.rung : DEFAULT_RUNG,
    stack: {
      language: row.language,
      framework: row.framework,
      packageManager: row.package_manager,
      packageManagerVersion: row.package_manager_version ?? '',
      install: row.install_command ?? '',
      build: row.build_command ?? '',
      test: row.test_command ?? '',
      lint: row.lint_command ?? '',
    },
    addedAt: row.added_at,
  }
}
