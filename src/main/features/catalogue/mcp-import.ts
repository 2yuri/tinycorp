import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpImportCandidate, McpImportPreview } from '../../../shared/catalogue/mcp-import'
import {
  BEARER_HEADER,
  isMcpHeaderName,
  type McpServerInput,
  type McpTransport,
  mcpServerProblems,
} from '../../../shared/catalogue/mcp-servers'
import type { Provider } from '../../../shared/domain/providers'

/**
 * Reading the boss's own Claude Code config, so its MCP servers can be put in the catalogue
 * (T235, T245).
 *
 * Every Session is spawned with its Provider's strictest MCP flag (T136), so an Employee sees
 * nothing the boss has in their own config — which left the boss's own tools, Pen among them, on
 * the wrong side of a wall with no door. This is the door: the file is **read**, never written,
 * and what it holds becomes candidates the boss ticks.
 *
 * The values never leave this module. A preview carries names only, exactly as the Import .env
 * preview does (T176): {@link McpImporter.take} hands the values to the catalogue, which hands
 * them to the OS secret store, and the renderer is not on that path at any point.
 */

/** One entry of `mcpServers`, in the shape Claude Code writes it. Everything in it is unknown. */
interface ClaudeServerEntry {
  type?: unknown
  url?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  headers?: unknown
}

export interface McpImporter {
  /** Where the config would be on this machine, whether or not it is there. */
  path(): string
  /**
   * Reads the config and lists its servers by name, with `taken` — the names the catalogue
   * already holds — refusing the ones that would collide. The values found are held here, and a
   * second scan replaces them.
   */
  scan(taken: readonly string[]): McpImportPreview
  /**
   * What the catalogue is given for one previewed server: its fields, and its secrets, write-only.
   * Null for a name the last scan did not offer, which is how a renderer that asks for something
   * else gets nothing rather than something.
   */
  take(name: string): McpServerInput | null
}

/** The Provider this importer reads the config of. Its name is never written in a screen. */
const CLAUDE: Provider = 'claude'

/**
 * A reader per Provider whose own MCP configuration TinyCorp can read. This is the seam a second
 * product slots into: one entry here and one module beside this one, and the card grows a button
 * from {@link MCP_IMPORT_PROVIDERS} without a screen being edited.
 */
export function createMcpImporters(options: McpImporterOptions = {}): Partial<Record<Provider, McpImporter>> {
  return { [CLAUDE]: createMcpImporter(options) }
}

export interface McpImporterOptions {
  /** The boss's environment; `CLAUDE_CONFIG_DIR` moves the file, as Claude Code's own does. */
  env?: NodeJS.ProcessEnv
  /** Reads the file, or returns null when it is not there. Injected so a test needs no home. */
  readFile?: (path: string) => string | null
}

/** Where Claude Code keeps the boss's own config, on all three platforms. */
export function claudeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env['CLAUDE_CONFIG_DIR']?.trim()
  return join(dir || homedir(), '.claude.json')
}

export function createMcpImporter({ env = process.env, readFile = readIfThere }: McpImporterOptions = {}): McpImporter {
  /** The values of the last scan, by server name. Nothing else in the app can reach them. */
  let held = new Map<string, McpServerInput>()

  return {
    path: () => claudeConfigPath(env),

    scan(taken) {
      const path = claudeConfigPath(env)
      const entries = readServers(readFile(path))
      held = new Map()
      const servers = entries.map(([name, entry]) => {
        const { candidate, input } = candidateOf(name, entry, taken)
        if (input) held.set(name, input)
        return candidate
      })
      return { source: CLAUDE, path, servers }
    },

    take: (name) => held.get(name) ?? null,
  }
}

/** The `mcpServers` of the user-level config, in the file's own order. Never a project's. */
function readServers(text: string | null): [string, ClaudeServerEntry][] {
  if (text === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A config this app cannot read is a config with nothing to import, not a crash: Claude Code
    // owns that file and may write anything into it.
    return []
  }
  if (!isRecord(parsed)) return []
  const servers = parsed['mcpServers']
  if (!isRecord(servers)) return []
  return Object.entries(servers).filter((entry): entry is [string, ClaudeServerEntry] => isRecord(entry[1]))
}

/**
 * One entry as the dialog draws it, and — when it can be imported at all — the input the
 * catalogue would take. A `stdio` server's whole environment is treated as secret, because
 * TinyCorp cannot tell which half of it is: nothing of it goes in the Company database, and only
 * the variable names are ever shown.
 */
function candidateOf(
  name: string,
  entry: ClaudeServerEntry,
  taken: readonly string[],
): { candidate: McpImportCandidate; input: McpServerInput | null } {
  const transport = transportOf(entry)
  const url = text(entry.url)
  const command = text(entry.command)
  const args = list(entry.args)
  const env = record(entry.env)
  const headers = record(entry.headers)
  const token = bearerIn(headers)

  const named = namedHeaders(headers)

  const problem =
    nameProblem(name, taken) ??
    transportProblem(entry, transport) ??
    fieldProblem(transport, url, command) ??
    headerProblem(named)

  const candidate: McpImportCandidate = {
    name,
    transport: transport === 'http' ? 'http' : 'stdio',
    target: transport === 'http' ? url : [command, ...args].filter(Boolean).join(' '),
    secretNames: transport === 'http' ? Object.keys(named) : Object.keys(env),
    hasToken: transport === 'http' && token !== null,
    chosen: problem === null,
    problem,
  }
  if (problem !== null) return { candidate, input: null }

  const input: McpServerInput =
    transport === 'http'
      ? {
          name,
          transport: 'http',
          url,
          ...(token !== null && { secret: token }),
          ...(Object.keys(named).length > 0 && { headerSecrets: named }),
        }
      : { name, transport: 'stdio', command, args, env: {}, secrets: env }
  return { candidate, input }
}

/**
 * The headers besides the bearer one. Every value of them is treated as a secret, for the same
 * reason a `stdio` server's whole environment is (T235): this is somebody else's config and
 * TinyCorp cannot tell which half of it is private, so none of it is written to the Company
 * database — only the names are, and the values go to the OS store (T245).
 */
function namedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== BEARER_HEADER))
}

/** What Claude Code says this server is, or what its fields say when it says nothing. */
function transportOf(entry: ClaudeServerEntry): McpTransport | 'sse' | 'unknown' {
  const type = text(entry.type)
  if (type === 'http' || type === 'stdio' || type === 'sse') return type
  if (type !== '') return 'unknown'
  return text(entry.url) ? 'http' : 'stdio'
}

/** A transport TinyCorp has no way to spawn or call is listed and refused, never guessed at. */
function transportProblem(entry: ClaudeServerEntry, transport: ReturnType<typeof transportOf>): string | null {
  if (transport === 'sse') return 'sse — TinyCorp carries http and stdio'
  if (transport === 'unknown') return `${text(entry.type)} — TinyCorp carries http and stdio`
  return null
}

/** The name, in the catalogue's own words — except the collision, which the row says shortly. */
function nameProblem(name: string, taken: readonly string[]): string | null {
  if (taken.some((other) => other.toLowerCase() === name.toLowerCase())) return 'already in the catalogue'
  const problems = mcpServerProblems({ name, transport: 'stdio', command: 'x' }, [])
  return problems.name ?? null
}

function fieldProblem(transport: ReturnType<typeof transportOf>, url: string, command: string): string | null {
  if (transport === 'http') return url ? null : 'no url'
  return command ? null : 'no command'
}

/**
 * A header-authenticated server comes across with its headers now (T245): the catalogue keeps their
 * names and the OS store keeps their values. What is still refused is a header **name** the
 * catalogue cannot carry — one an adapter would have to quote into a config key — because importing
 * it would be importing a server that half works.
 */
function headerProblem(headers: Record<string, string>): string | null {
  const odd = Object.keys(headers).filter((name) => !isMcpHeaderName(name))
  if (odd.length === 0) return null
  return `${odd.join(', ')} — not a header name TinyCorp can carry`
}

/** The bearer token of an `authorization` header, or null. The header name's case is the file's. */
function bearerIn(headers: Record<string, string>): string | null {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')
  if (!found) return null
  const value = found[1].trim()
  return value.replace(/^Bearer\s+/i, '') || null
}

function readIfThere(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function record(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => text(entry[1]) !== ''))
}
