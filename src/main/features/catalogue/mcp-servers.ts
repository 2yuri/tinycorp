import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  BEARER_HEADER,
  isMcpHeaderName,
  MCP_TRANSPORTS,
  type McpServer,
  type McpServerImpact,
  type McpServerInput,
  type McpServerRow,
  type McpTransport,
  mcpServerProblems,
} from '../../../shared/catalogue/mcp-servers'
import type { McpGrants } from '../../../shared/domain/staff'
import type { Migration } from '../../core'
import type { SecretStore } from '../../platform'
import type { GrantedMcpServer } from '../../providers'

/**
 * The Company's own catalogue of outside MCP servers (T136, decision 57).
 *
 * Adding, editing and removing one is the boss's, the way deleting a channel and setting a topic
 * are (T112, T44): no MCP tool grants an MCP server, so no Employee can widen its own hands. What
 * an Employee holds is a job field that follows its role, and what it is handed at spawn is
 * resolved here, with each secret read from the keychain at that moment and nowhere else.
 *
 * Nothing here reads the boss's own `~/.claude.json`, `~/.codex/` or OpenCode data folder. The
 * catalogue is typed in once, in Company settings, and it is the whole of what an Employee can get.
 */

/** The catalogue table, and the grant beside `persona`, `capabilities` and `repo_filter`. */
export const MCP_SERVERS_MIGRATION: Migration = {
  name: 'mcp-server-catalogue-and-grants',
  sql: `
  CREATE TABLE mcp_server (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL,
    url TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT NOT NULL,
    env TEXT NOT NULL,
    secret_env TEXT NOT NULL,
    has_secret INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );
  ALTER TABLE role_template ADD COLUMN mcp_servers TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE employee ADD COLUMN mcp_servers TEXT NOT NULL DEFAULT '[]';
`,
}

/**
 * The names — never the values — of the further secrets an imported server carries (T235). One
 * row of the catalogue can now hold a value per environment variable it named, each under its own
 * key in the OS store; this column is the list of those names, so the engine knows what to ask the
 * store for and the screens have something to show that is not a secret.
 */
export const MCP_SECRET_NAMES_MIGRATION: Migration = {
  name: 'mcp-server-secret-names',
  sql: `ALTER TABLE mcp_server ADD COLUMN secret_names TEXT NOT NULL DEFAULT '[]';`,
}

/**
 * Named header authentication for an `http` server (T245). Two columns: the headers whose values
 * are plain text — SigNoz wants to be told which instance is its own — and the **names** of the
 * headers whose values are in the OS store, which is how Datadog's two keys and SigNoz's service
 * account key travel. A value of one of those is never in this database, exactly as a `stdio`
 * server's named environment values are not (T235).
 */
export const MCP_HEADERS_MIGRATION: Migration = {
  name: 'mcp-server-header-auth',
  sql: `
  ALTER TABLE mcp_server ADD COLUMN headers TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE mcp_server ADD COLUMN header_secret_names TEXT NOT NULL DEFAULT '[]';
`,
}

/**
 * Where one of a server's named secrets is kept in the OS store. The server's own id is the key
 * of its token (the one the boss types into the form), so a named value takes the id and the
 * name together — an environment variable's for a `stdio` server, a header's for an `http` one,
 * and a server is only ever one of the two — and a Company that removes the server forgets every
 * one of them.
 */
export function namedSecretKey(serverId: string, name: string): string {
  return `${serverId}:${name}`
}

export interface McpCatalogue {
  list(): McpServerRow[]
  create(input: McpServerInput): McpServerRow
  update(id: string, patch: Partial<McpServerInput>): McpServerRow
  /** What removing this server would take with it, counted before anything is done. */
  impact(id: string): McpServerImpact
  /**
   * Removes the server, takes the grant off every Employee and every role that held it, and
   * forgets its secret. The boss is told the impact first; this does it.
   */
  remove(id: string): void
  /** Called after any change to the catalogue or to who holds what. */
  onChange(listener: () => void): () => void
}

export interface McpCatalogueOptions {
  /** The current Company's database and id; throws when none is open. */
  current(): { db: DatabaseSync; companyId: string }
  secrets: SecretStore
  /** Called after the catalogue changes, so the staff and the office can be told too. */
  notify(): void
}

export function createMcpCatalogue({ current, secrets, notify }: McpCatalogueOptions): McpCatalogue {
  const listeners = new Set<() => void>()
  const changed = () => {
    notify()
    for (const listener of listeners) listener()
  }

  return {
    list() {
      const { db } = current()
      return listServers(db)
    },

    create(input) {
      const { db, companyId } = current()
      const server: McpServer = {
        id: randomUUID(),
        ...cleanInput(input, db),
      }
      const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM mcp_server').get() as {
        next: number
      }
      const secret = trimmedSecret(input.secret)
      db.prepare(
        `INSERT INTO mcp_server (id, name, transport, url, command, args, env, secret_env, has_secret, secret_names,
           headers, header_secret_names, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        server.id,
        server.name,
        server.transport,
        server.url,
        server.command,
        JSON.stringify(server.args),
        JSON.stringify(server.env),
        server.secretEnv,
        secret ? 1 : 0,
        JSON.stringify(server.secretNames),
        JSON.stringify(server.headers),
        JSON.stringify(server.headerSecretNames),
        next,
      )
      if (secret) secrets.set(companyId, server.id, secret)
      writeNamedSecrets(secrets, companyId, server.id, server.secretNames, input.secrets)
      writeNamedSecrets(secrets, companyId, server.id, server.headerSecretNames, input.headerSecrets)
      changed()
      return { ...server, hasSecret: Boolean(secret), employees: 0 }
    },

    update(id, patch) {
      const { db, companyId } = current()
      const before = findServer(db, id)
      const next = cleanInput({ ...before, ...patch }, db, id)
      db.prepare(
        `UPDATE mcp_server SET name = ?, transport = ?, url = ?, command = ?, args = ?, env = ?, secret_env = ?,
         secret_names = ?, headers = ?, header_secret_names = ? WHERE id = ?`,
      ).run(
        next.name,
        next.transport,
        next.url,
        next.command,
        JSON.stringify(next.args),
        JSON.stringify(next.env),
        next.secretEnv,
        JSON.stringify(next.secretNames),
        JSON.stringify(next.headers),
        JSON.stringify(next.headerSecretNames),
        id,
      )
      // The named values are written before the token, so a patch that changes neither leaves the
      // store exactly as it was: `secrets` undefined keeps them, and a name that has gone from the
      // list is forgotten rather than left behind under a key nothing reads.
      forgetNamedSecrets(secrets, companyId, id, before.secretNames, next.secretNames)
      writeNamedSecrets(secrets, companyId, id, next.secretNames, patch.secrets)
      forgetNamedSecrets(secrets, companyId, id, before.headerSecretNames, next.headerSecretNames)
      writeNamedSecrets(secrets, companyId, id, next.headerSecretNames, patch.headerSecrets)
      // `secret` is write-only: a string replaces what the keychain holds, null forgets it, and
      // leaving it out means the boss did not touch the secret at all.
      if (patch.secret !== undefined) {
        const secret = trimmedSecret(patch.secret)
        if (secret) secrets.set(companyId, id, secret)
        else secrets.forget(companyId, id)
        db.prepare('UPDATE mcp_server SET has_secret = ? WHERE id = ?').run(secret ? 1 : 0, id)
      }
      changed()
      return rowOf(db, id)
    },

    impact(id) {
      const { db } = current()
      return impactOf(db, findServer(db, id))
    },

    remove(id) {
      const { db, companyId } = current()
      const server = findServer(db, id)
      dropGrant(db, 'employee', id)
      dropGrant(db, 'role_template', id)
      db.prepare('DELETE FROM mcp_server WHERE id = ?').run(id)
      secrets.forget(companyId, id)
      forgetNamedSecrets(secrets, companyId, id, server.secretNames, [])
      forgetNamedSecrets(secrets, companyId, id, server.headerSecretNames, [])
      changed()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Every server in the Company, in catalogue order, with who holds it. Never a secret. */
export function listServers(db: DatabaseSync): McpServerRow[] {
  const rows = db.prepare('SELECT * FROM mcp_server ORDER BY position, rowid').all() as unknown as ServerRow[]
  const held = holders(db)
  return rows.map((row) => ({ ...toServer(row), hasSecret: row.has_secret === 1, employees: held.get(row.id) ?? 0 }))
}

/**
 * The servers an Employee is handed at spawn, in catalogue order, each with its secret read from
 * the keychain right here. A granted id the catalogue no longer holds is simply not there, so a
 * stale grant hands out nothing.
 */
export function grantedServers(
  db: DatabaseSync,
  companyId: string,
  grants: McpGrants,
  secrets: SecretStore,
): GrantedMcpServer[] {
  if (grants.length === 0) return []
  const wanted = new Set(grants)
  const rows = db.prepare('SELECT * FROM mcp_server ORDER BY position, rowid').all() as unknown as ServerRow[]
  return rows
    .filter((row) => wanted.has(row.id))
    .map((row) => {
      const server = toServer(row)
      return {
        name: server.name,
        transport: server.transport,
        url: server.url,
        command: server.command,
        args: server.args,
        env: server.env,
        secretEnv: server.secretEnv,
        secret: row.has_secret === 1 ? secrets.read(companyId, row.id) : null,
        secrets: readNamedSecrets(secrets, companyId, row.id, server.secretNames),
        headers: server.headers,
        headerSecrets: readNamedSecrets(secrets, companyId, row.id, server.headerSecretNames),
      }
    })
}

/** What an Employee's instructions say it has: the servers, without anything secret in them. */
export function grantSummaries(
  db: DatabaseSync,
  grants: McpGrants,
): { name: string; transport: McpTransport; target: string }[] {
  const wanted = new Set(grants)
  return listServers(db)
    .filter((server) => wanted.has(server.id))
    .map((server) => ({
      name: server.name,
      transport: server.transport,
      target: server.transport === 'http' ? server.url : [server.command, ...server.args].filter(Boolean).join(' '),
    }))
}

/** Grants as they are stored: known ids only, in catalogue order, each at most once. */
export function cleanGrants(db: DatabaseSync, grants: unknown): McpGrants {
  if (!Array.isArray(grants) || grants.some((id) => typeof id !== 'string')) {
    throw new Error('MCP servers are given as a list of ids')
  }
  const wanted = new Set(grants as string[])
  const known = (db.prepare('SELECT id FROM mcp_server ORDER BY position, rowid').all() as { id: string }[]).map(
    (row) => row.id,
  )
  for (const id of wanted) {
    if (!known.includes(id)) throw new Error(`Unknown MCP server: ${id}`)
  }
  return known.filter((id) => wanted.has(id))
}

/** The servers one Employee holds, as stored. Empty for an Employee the catalogue never reached. */
export function employeeGrants(db: DatabaseSync, employeeId: string): McpGrants {
  const row = db.prepare('SELECT mcp_servers FROM employee WHERE id = ?').get(employeeId) as
    | { mcp_servers: string | null }
    | undefined
  return parseGrants(row?.mcp_servers ?? null)
}

export function parseGrants(text: string | null): McpGrants {
  if (!text) return []
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter((id): id is string => typeof id === 'string')
}

function impactOf(db: DatabaseSync, server: McpServer): McpServerImpact {
  return {
    name: server.name,
    employees: countHolding(db, 'employee', server.id),
    roles: countHolding(db, 'role_template', server.id),
  }
}

/** How many Employees hold each server; fired Employees hold nothing. */
function holders(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare('SELECT mcp_servers FROM employee WHERE fired_at IS NULL').all() as {
    mcp_servers: string | null
  }[]
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const id of new Set(parseGrants(row.mcp_servers))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function countHolding(db: DatabaseSync, table: 'employee' | 'role_template', id: string): number {
  const where = table === 'employee' ? ' WHERE fired_at IS NULL' : ''
  const rows = db.prepare(`SELECT mcp_servers FROM ${table}${where}`).all() as { mcp_servers: string | null }[]
  return rows.filter((row) => parseGrants(row.mcp_servers).includes(id)).length
}

/** Takes one server off every row of a table that held it, leaving the rest of each list alone. */
function dropGrant(db: DatabaseSync, table: 'employee' | 'role_template', id: string): void {
  const rows = db.prepare(`SELECT rowid AS rowid, mcp_servers FROM ${table}`).all() as {
    rowid: number
    mcp_servers: string | null
  }[]
  const write = db.prepare(`UPDATE ${table} SET mcp_servers = ? WHERE rowid = ?`)
  for (const row of rows) {
    const grants = parseGrants(row.mcp_servers)
    if (!grants.includes(id)) continue
    write.run(JSON.stringify(grants.filter((held) => held !== id)), row.rowid)
  }
}

/** The input as it is stored: trimmed, validated, and with the other transport's fields emptied. */
function cleanInput(input: McpServerInput, db: DatabaseSync, exceptId = ''): Omit<McpServer, 'id'> {
  const transport = input.transport
  if (!MCP_TRANSPORTS.includes(transport)) throw new Error(`Unknown transport: ${String(transport)}`)
  const name = (input.name ?? '').trim()
  const url = (input.url ?? '').trim()
  const command = (input.command ?? '').trim()
  const secretEnv = (input.secretEnv ?? '').trim()
  const taken = (db.prepare('SELECT name FROM mcp_server WHERE id != ?').all(exceptId) as { name: string }[]).map(
    (row) => row.name,
  )

  const problems = mcpServerProblems({ name, transport, url, command, secretEnv }, taken)
  const first = Object.values(problems)[0]
  if (first) throw new Error(first)

  return {
    name,
    transport,
    url: transport === 'http' ? url : '',
    command: transport === 'stdio' ? command : '',
    args: transport === 'stdio' ? cleanArgs(input.args) : [],
    env: transport === 'stdio' ? cleanEnv(input.env) : {},
    secretEnv: transport === 'stdio' ? secretEnv : '',
    secretNames: transport === 'stdio' ? cleanSecretNames(input) : [],
    headers: transport === 'http' ? cleanHeaders(input.headers) : {},
    headerSecretNames: transport === 'http' ? cleanHeaderSecretNames(input) : [],
  }
}

/**
 * The plain headers as they are stored (T245). Every name is checked, and `authorization` is
 * refused: a bearer token is the server's own secret, and a header of that name beside it would be
 * a second answer to the same question — written into the database, where a token may not go.
 */
function cleanHeaders(headers: unknown): Record<string, string> {
  if (headers === undefined) return {}
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers))
    throw new Error('Headers are a set of names and values')
  const entries = Object.entries(headers as Record<string, unknown>)
  for (const [name, value] of entries) {
    if (typeof value !== 'string') throw new Error(`Header value for ${name} must be text`)
    requireHeaderName(name)
  }
  return Object.fromEntries(entries as [string, string][])
}

/**
 * The names of the header values kept in the OS store. Given `headerSecrets`, they are its keys;
 * given none, they are whatever the row already held, so an edit that changes only the URL of an
 * imported server does not drop the headers it authenticates with.
 */
function cleanHeaderSecretNames(input: McpServerInput & { headerSecretNames?: unknown }): string[] {
  const names = input.headerSecrets
    ? Object.keys(input.headerSecrets)
    : ((input.headerSecretNames as string[] | undefined) ?? [])
  for (const name of names) requireHeaderName(name)
  return [...new Set(names)]
}

function requireHeaderName(name: string): void {
  if (!isMcpHeaderName(name)) throw new Error(`Not a header name TinyCorp can carry: ${name}`)
  if (name.toLowerCase() === BEARER_HEADER) throw new Error('A bearer token is the server’s own secret, not a header')
}

/**
 * The names of the values kept in the OS store for this server. Given `secrets`, they are its
 * keys; given none, they are whatever the row already held, so an edit that does not touch the
 * secrets does not drop them either.
 */
function cleanSecretNames(input: McpServerInput & { secretNames?: unknown }): string[] {
  const names = input.secrets ? Object.keys(input.secrets) : ((input.secretNames as string[] | undefined) ?? [])
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Not an environment variable name: ${name}`)
  }
  return [...new Set(names)]
}

/** Writes one value per name, straight to the OS store. Nothing here touches the database. */
function writeNamedSecrets(
  secrets: SecretStore,
  companyId: string,
  serverId: string,
  names: readonly string[],
  values: Record<string, string> | undefined,
): void {
  if (!values) return
  for (const name of names) {
    const value = trimmedSecret(values[name])
    if (value) secrets.set(companyId, namedSecretKey(serverId, name), value)
    else secrets.forget(companyId, namedSecretKey(serverId, name))
  }
}

/** Forgets every name that `next` no longer holds, so nothing is left in the store unreferenced. */
function forgetNamedSecrets(
  secrets: SecretStore,
  companyId: string,
  serverId: string,
  before: readonly string[],
  next: readonly string[],
): void {
  for (const name of before) {
    if (!next.includes(name)) secrets.forget(companyId, namedSecretKey(serverId, name))
  }
}

/** The values, read from the OS store at this moment. A name the store has lost is left out. */
function readNamedSecrets(
  secrets: SecretStore,
  companyId: string,
  serverId: string,
  names: readonly string[],
): Record<string, string> {
  const found: Record<string, string> = {}
  for (const name of names) {
    const value = secrets.read(companyId, namedSecretKey(serverId, name))
    if (value !== null) found[name] = value
  }
  return found
}

function cleanArgs(args: unknown): string[] {
  if (args === undefined) return []
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('Arguments are a list of strings')
  }
  return (args as string[]).map((arg) => arg.trim()).filter(Boolean)
}

function cleanEnv(env: unknown): Record<string, string> {
  if (env === undefined) return {}
  if (typeof env !== 'object' || env === null || Array.isArray(env))
    throw new Error('Environment is a set of names and values')
  const entries = Object.entries(env as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (typeof value !== 'string') throw new Error(`Environment value for ${key} must be text`)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Not an environment variable name: ${key}`)
  }
  return Object.fromEntries(entries as [string, string][])
}

/** A secret with nothing in it is no secret: it forgets whatever the keychain held. */
function trimmedSecret(secret: string | null | undefined): string | null {
  if (typeof secret !== 'string') return null
  const trimmed = secret.trim()
  return trimmed === '' ? null : trimmed
}

interface ServerRow {
  id: string
  name: string
  transport: string
  url: string
  command: string
  args: string
  env: string
  secret_env: string
  has_secret: number
  secret_names: string
  headers: string
  header_secret_names: string
  position: number
}

function toServer(row: ServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    url: row.url,
    command: row.command,
    args: JSON.parse(row.args) as string[],
    env: JSON.parse(row.env) as Record<string, string>,
    secretEnv: row.secret_env,
    secretNames: JSON.parse(row.secret_names) as string[],
    headers: JSON.parse(row.headers) as Record<string, string>,
    headerSecretNames: JSON.parse(row.header_secret_names) as string[],
  }
}

function findServer(db: DatabaseSync, id: string): McpServer {
  const row = db.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as ServerRow | undefined
  if (!row) throw new Error(`Unknown MCP server: ${id}`)
  return toServer(row)
}

function rowOf(db: DatabaseSync, id: string): McpServerRow {
  const row = listServers(db).find((server) => server.id === id)
  if (!row) throw new Error(`Unknown MCP server: ${id}`)
  return row
}
