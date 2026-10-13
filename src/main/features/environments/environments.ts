import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  defaultEnvironment,
  ENVIRONMENT_IDS,
  type Environment,
  type EnvironmentId,
  type EnvVariable,
  type ImportPreview,
  importPreview,
  isEnvironmentId,
  nameProblem,
  parseEnvFile,
  secretProblem,
} from '../../../shared/environments'
import type { RedactableValue } from '../../../shared/platform/redaction'
import type { Migration } from '../../core'
import { namedSecretStore, type SecretBackend, type SecretStore } from '../../platform'

/**
 * The Company's Environments (T176): what is in each one, which repos may use it, and which repo
 * runs which by default.
 *
 * The split is the whole point. A name, an environment and a repo scope are facts about the
 * Company, so they are rows here. A **value** is not: it goes to the OS secret store under
 * `env:<environment>:<NAME>` and is read back at one moment only — the child process `env_run`
 * spawns. Nothing in this file returns a value to the renderer, to an Employee or to a log; the
 * one function that hands values out is {@link EnvironmentStore.valuesFor}, and the engine gives
 * it to the runner and to nothing else.
 */

/**
 * The environments, their variables, and the default environment of a repo.
 *
 * `environment` carries a row only once the boss changes one of its toggles: the three ids are in
 * the code, not the data, so a Company that never opened the tab has nothing to migrate.
 */
export const ENVIRONMENTS_MIGRATION: Migration = {
  name: 'environments-variables-and-env-run-requests',
  sql: `
  CREATE TABLE environment (
    id TEXT PRIMARY KEY,
    ask_every_use INTEGER NOT NULL,
    available_to_checks INTEGER NOT NULL
  );
  CREATE TABLE environment_variable (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    name TEXT NOT NULL,
    repos TEXT NOT NULL DEFAULT '[]',
    last_used_by TEXT,
    last_used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX environment_variable_name ON environment_variable (environment_id, name);
  ALTER TABLE repo ADD COLUMN default_environment TEXT;
  CREATE TABLE env_run_request (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_id INTEGER NOT NULL REFERENCES approval (id),
    employee_id TEXT NOT NULL REFERENCES employee (id),
    environment_id TEXT NOT NULL,
    repo_id TEXT,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX env_run_request_open ON env_run_request (employee_id, environment_id, used_at);
`,
}

/** What one variable is created or changed with. `value` never leaves this process's memory. */
export interface EnvVariableInput {
  environment: EnvironmentId
  name: string
  /** The new value, or undefined to keep the one already in the secret store. */
  value?: string
  /** The repos allowed to use it; empty is every repo of the Company. */
  repoIds?: string[]
}

/** Which repo, in which environment, a command is about to run under. */
export interface EnvironmentUse {
  environment: EnvironmentId
  /** The repo the command runs in, or null when it runs somewhere that is not a repo. */
  repoId: string | null
}

export interface EnvironmentStore {
  /** The three environments with their toggles and counts, in switch order. */
  list(): Environment[]
  /** Every variable of one environment, or of all of them, in name order. Never a value. */
  variables(environment?: EnvironmentId): EnvVariable[]
  setAskEveryUse(environment: EnvironmentId, on: boolean): Environment
  setAvailableToChecks(environment: EnvironmentId, on: boolean): Environment
  /** Adds a variable. The value goes straight to the secret store; the row records the rest. */
  add(input: EnvVariableInput & { value: string }): EnvVariable
  /** Changes a variable's name, scope or value. Renaming moves the secret to the new account. */
  update(id: string, patch: Partial<EnvVariableInput>): EnvVariable
  /** Removes the row and forgets the value. */
  remove(id: string): void
  /**
   * The value, for the boss's own Reveal or Copy. The one read in the app that returns a value,
   * and the IPC in front of it asks the OS who is there first.
   */
  reveal(id: string): string
  /**
   * The names and values one use is allowed, already narrowed to the repo's scope. `scope` names
   * the Company when it is not the one on screen — a Session of another open Company is still
   * running, and its runs are its own Company's (T176).
   */
  valuesFor(use: EnvironmentUse, scope?: CompanyScope): RedactableValue[]
  /** Records that `employeeId` used these variables just now, for the LAST USED column. */
  markUsed(use: EnvironmentUse, employeeId: string, at: string): void
  /** Which environment a repo runs by default, or null when it runs none. */
  repoDefault(repoId: string): EnvironmentId | null
  /**
   * What the Testing stage's Run it and the repo checks run with (T174): the repo's default
   * environment, when it is one that is available to checks. Null means run them as before.
   */
  forChecks(repoId: string, scope?: CompanyScope): EnvironmentUse | null
  setRepoDefault(repoId: string, environment: EnvironmentId | null): void
  /** The keys of a `.env` file against what the environment already holds. No value comes back. */
  preview(file: string, environment: EnvironmentId, text: string): ImportPreview
  /** Imports the chosen keys of a parsed file. The file itself is never copied anywhere. */
  importKeys(environment: EnvironmentId, entries: readonly { name: string; value: string }[]): EnvVariable[]
  /** Called after anything here changes. */
  onChange(listener: () => void): () => void
}

/** One Company's database and id, for a read that must not be about whichever is on screen. */
export interface CompanyScope {
  db: DatabaseSync
  companyId: string
}

export interface EnvironmentStoreOptions {
  /** The current Company's database and id; throws when none is open. */
  current(): { db: DatabaseSync; companyId: string }
  secrets: SecretStore
  notify(): void
  /**
   * Which store this machine really has (T177, T218). Injected rather than read from
   * `process.platform` here: what the boss is told about a value that has gone missing has to name
   * the store that was actually asked, and the one place that is decided is
   * `safe-storage-secrets.ts`. A test that leaves it out is answered for a Mac.
   */
  backend?: () => SecretBackend
}

/** The secret store account one variable's value lives under, inside the Company's own scope. */
export function secretAccount(environment: EnvironmentId, name: string): string {
  return `env:${environment}:${name}`
}

/**
 * The environments of one database, with the names each holds and the repos that run it by
 * default. Read from a database rather than from the open Company, because an Employee's
 * instructions are rendered for whichever Company its Session belongs to.
 */
export function environmentSummary(db: DatabaseSync): {
  id: EnvironmentId
  askEveryUse: boolean
  availableToChecks: boolean
  names: string[]
  repos: string[]
}[] {
  return ENVIRONMENT_IDS.map((id) => {
    const row = db.prepare('SELECT * FROM environment WHERE id = ?').get(id) as
      | { ask_every_use: number; available_to_checks: number }
      | undefined
    const names = (
      db.prepare('SELECT name FROM environment_variable WHERE environment_id = ? ORDER BY name').all(id) as unknown as {
        name: string
      }[]
    ).map((variable) => variable.name)
    const repos = (
      db.prepare('SELECT name FROM repo WHERE default_environment = ? ORDER BY name').all(id) as unknown as {
        name: string
      }[]
    ).map((repo) => repo.name)
    const defaults = defaultEnvironment(id)
    return {
      id,
      askEveryUse: row ? row.ask_every_use === 1 : defaults.askEveryUse,
      availableToChecks: row ? row.available_to_checks === 1 : defaults.availableToChecks,
      names,
      repos,
    }
  })
}

interface VariableRow {
  id: string
  environment_id: string
  name: string
  repos: string
  last_used_by: string | null
  last_used_at: string | null
  created_at: string
}

export function createEnvironments({
  current,
  secrets,
  notify,
  backend = () => 'keychain',
}: EnvironmentStoreOptions): EnvironmentStore {
  const listeners = new Set<() => void>()
  const changed = () => {
    notify()
    for (const listener of listeners) listener()
  }

  function environmentId(value: unknown): EnvironmentId {
    if (!isEnvironmentId(value)) throw new Error(`There is no environment named ${JSON.stringify(value)}`)
    return value
  }

  function toggles(db: DatabaseSync, id: EnvironmentId): Omit<Environment, 'variableCount'> {
    const row = db.prepare('SELECT * FROM environment WHERE id = ?').get(id) as
      | { ask_every_use: number; available_to_checks: number }
      | undefined
    if (!row) return defaultEnvironment(id)
    return { id, askEveryUse: row.ask_every_use === 1, availableToChecks: row.available_to_checks === 1 }
  }

  function setToggle(id: EnvironmentId, change: { ask?: boolean; checks?: boolean }): Environment {
    const { db } = current()
    const before = toggles(db, id)
    const next = { ask: change.ask ?? before.askEveryUse, checks: change.checks ?? before.availableToChecks }
    db.prepare(
      `INSERT INTO environment (id, ask_every_use, available_to_checks) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET ask_every_use = excluded.ask_every_use,
         available_to_checks = excluded.available_to_checks`,
    ).run(id, next.ask ? 1 : 0, next.checks ? 1 : 0)
    changed()
    return { ...toggles(db, id), variableCount: countOf(db, id) }
  }

  function countOf(db: DatabaseSync, id: EnvironmentId): number {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM environment_variable WHERE environment_id = ?').get(id) as {
      n: number
    }
    return n
  }

  function toVariable(row: VariableRow): EnvVariable {
    return {
      id: row.id,
      environment: environmentId(row.environment_id),
      name: row.name,
      repoIds: parseRepos(row.repos),
      lastUsed: row.last_used_by && row.last_used_at ? { employeeId: row.last_used_by, at: row.last_used_at } : null,
    }
  }

  function find(db: DatabaseSync, id: string): VariableRow {
    const row = db.prepare('SELECT * FROM environment_variable WHERE id = ?').get(id) as VariableRow | undefined
    if (!row) throw new Error(`There is no variable ${id}`)
    return row
  }

  /** The rows one use may see: the environment's variables scoped to that repo, or to every repo. */
  function rowsFor(db: DatabaseSync, { environment, repoId }: EnvironmentUse): VariableRow[] {
    const rows = db
      .prepare('SELECT * FROM environment_variable WHERE environment_id = ? ORDER BY name')
      .all(environment) as unknown as VariableRow[]
    return rows.filter((row) => {
      const repos = parseRepos(row.repos)
      if (repos.length === 0) return true
      return repoId !== null && repos.includes(repoId)
    })
  }

  function write(db: DatabaseSync, companyId: string, row: VariableRow, patch: Partial<EnvVariableInput>): EnvVariable {
    const environment = patch.environment ? environmentId(patch.environment) : environmentId(row.environment_id)
    const name = (patch.name ?? row.name).trim()
    const problem = nameProblem(name)
    if (problem) throw new Error(problem)
    const repos = patch.repoIds ? [...new Set(patch.repoIds)] : parseRepos(row.repos)
    if (patch.value !== undefined) {
      const bad = secretProblem(patch.value)
      if (bad) throw new Error(bad)
    }
    const moved = environment !== row.environment_id || name !== row.name
    if (moved) {
      const clash = db
        .prepare('SELECT id FROM environment_variable WHERE environment_id = ? AND name = ? AND id != ?')
        .get(environment, name, row.id) as { id: string } | undefined
      if (clash) throw new Error(`${environment} already has a variable named ${name}`)
    }
    // The value moves before the row does, so a failed keychain write never leaves a row with no value.
    const value =
      patch.value ??
      (moved ? secrets.read(companyId, secretAccount(environmentId(row.environment_id), row.name)) : null)
    if (value !== null && value !== undefined) secrets.set(companyId, secretAccount(environment, name), value)
    if (moved) secrets.forget(companyId, secretAccount(environmentId(row.environment_id), row.name))
    db.prepare('UPDATE environment_variable SET environment_id = ?, name = ?, repos = ? WHERE id = ?').run(
      environment,
      name,
      JSON.stringify(repos),
      row.id,
    )
    return toVariable(find(db, row.id))
  }

  const store: EnvironmentStore = {
    list() {
      const { db } = current()
      return ENVIRONMENT_IDS.map((id) => ({ ...toggles(db, id), variableCount: countOf(db, id) }))
    },

    variables(environment) {
      const { db } = current()
      const rows = (environment
        ? db
            .prepare('SELECT * FROM environment_variable WHERE environment_id = ? ORDER BY name')
            .all(environmentId(environment))
        : db
            .prepare('SELECT * FROM environment_variable ORDER BY environment_id, name')
            .all()) as unknown as VariableRow[]
      return rows.map(toVariable)
    },

    setAskEveryUse: (environment, on) => setToggle(environmentId(environment), { ask: on }),

    setAvailableToChecks: (environment, on) => setToggle(environmentId(environment), { checks: on }),

    add(input) {
      const { db, companyId } = current()
      const environment = environmentId(input.environment)
      const name = input.name.trim()
      const problem = nameProblem(name) ?? secretProblem(input.value)
      if (problem) throw new Error(problem)
      if (
        db.prepare('SELECT id FROM environment_variable WHERE environment_id = ? AND name = ?').get(environment, name)
      ) {
        throw new Error(`${environment} already has a variable named ${name}`)
      }
      const id = randomUUID()
      secrets.set(companyId, secretAccount(environment, name), input.value)
      db.prepare(
        'INSERT INTO environment_variable (id, environment_id, name, repos, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, environment, name, JSON.stringify([...new Set(input.repoIds ?? [])]), new Date().toISOString())
      changed()
      return toVariable(find(db, id))
    },

    update(id, patch) {
      const { db, companyId } = current()
      const variable = write(db, companyId, find(db, id), patch)
      changed()
      return variable
    },

    remove(id) {
      const { db, companyId } = current()
      const row = find(db, id)
      db.prepare('DELETE FROM environment_variable WHERE id = ?').run(id)
      secrets.forget(companyId, secretAccount(environmentId(row.environment_id), row.name))
      changed()
    },

    reveal(id) {
      const { db, companyId } = current()
      const row = find(db, id)
      const value = secrets.read(companyId, secretAccount(environmentId(row.environment_id), row.name))
      if (value === null) {
        // Named after the store this machine really has (T218). The sentence promised a Mac's
        // keychain on every platform, which is the app describing a lock it does not have.
        const store = namedSecretStore(backend())
        throw new Error(
          `${row.name} has no value in ${store}. It was set on another machine, or the item was ` +
            `removed from ${store}; set it again here.`,
        )
      }
      return value
    },

    valuesFor(use, scope) {
      const { db, companyId } = scope ?? current()
      const found: RedactableValue[] = []
      for (const row of rowsFor(db, { ...use, environment: environmentId(use.environment) })) {
        const value = secrets.read(companyId, secretAccount(environmentId(row.environment_id), row.name))
        // A variable whose value this machine does not hold is left out rather than injected empty:
        // an empty `DATABASE_URL` is a worse failure than a missing one.
        if (value !== null) found.push({ name: row.name, value })
      }
      return found
    },

    markUsed(use, employeeId, at) {
      const { db } = current()
      const update = db.prepare('UPDATE environment_variable SET last_used_by = ?, last_used_at = ? WHERE id = ?')
      for (const row of rowsFor(db, { ...use, environment: environmentId(use.environment) })) {
        update.run(employeeId, at, row.id)
      }
      changed()
    },

    repoDefault(repoId) {
      const { db } = current()
      const row = db.prepare('SELECT default_environment FROM repo WHERE id = ?').get(repoId) as
        | { default_environment: string | null }
        | undefined
      return row && isEnvironmentId(row.default_environment) ? row.default_environment : null
    },

    forChecks(repoId, scope) {
      const { db } = scope ?? current()
      const row = db.prepare('SELECT default_environment FROM repo WHERE id = ?').get(repoId) as
        | { default_environment: string | null }
        | undefined
      if (!row || !isEnvironmentId(row.default_environment)) return null
      const environment = row.default_environment
      return toggles(db, environment).availableToChecks ? { environment, repoId } : null
    },

    setRepoDefault(repoId, environment) {
      const { db } = current()
      db.prepare('UPDATE repo SET default_environment = ? WHERE id = ?').run(
        environment === null ? null : environmentId(environment),
        repoId,
      )
      changed()
    },

    preview(file, environment, text) {
      const { db } = current()
      const id = environmentId(environment)
      const held = (
        db.prepare('SELECT name FROM environment_variable WHERE environment_id = ?').all(id) as unknown as {
          name: string
        }[]
      ).map((row) => row.name)
      return importPreview(file, id, parseEnvFile(text), held)
    },

    importKeys(environment, entries) {
      const { db, companyId } = current()
      const id = environmentId(environment)
      const imported: EnvVariable[] = []
      for (const { name, value } of entries) {
        const problem = nameProblem(name) ?? secretProblem(value)
        if (problem) throw new Error(`${name}: ${problem}`)
        const existing = db
          .prepare('SELECT * FROM environment_variable WHERE environment_id = ? AND name = ?')
          .get(id, name) as VariableRow | undefined
        if (existing) {
          imported.push(write(db, companyId, existing, { value }))
          continue
        }
        const rowId = randomUUID()
        secrets.set(companyId, secretAccount(id, name), value)
        db.prepare(
          'INSERT INTO environment_variable (id, environment_id, name, repos, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(rowId, id, name, '[]', new Date().toISOString())
        imported.push(toVariable(find(db, rowId)))
      }
      changed()
      return imported
    },

    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
  return store
}

function parseRepos(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
