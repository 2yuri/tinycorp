import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import {
  BEARER_HEADER,
  isMcpHeaderName,
  type McpServerInput,
  type McpTransport,
  mcpServerProblems,
} from '../../../shared/catalogue/mcp-servers'
import {
  MCP_SOURCES,
  type McpFoundGroup,
  type McpFoundServer,
  type McpSource,
} from '../../../shared/catalogue/mcp-sources'

/**
 * Reading the MCP servers the boss already has on this machine (T242).
 *
 * Every Session is spawned with its Provider's strictest MCP flag (T136), so an Employee sees
 * nothing the boss has configured for themselves. T235 opened one door, for one product, behind a
 * button. This opens the rest of them and needs no button: six tools keep their MCP servers in a
 * file, this reads all six, and what it finds is a row the boss adds in one click.
 *
 * **The files are read and never written.** They belong to other programs; TinyCorp has no
 * business in them beyond looking. And the values never leave this module: a group carries names
 * only, and {@link McpSources.take} hands the values to the catalogue, which hands them to the OS
 * secret store. The renderer is not on that path at any point.
 */

/** One server as any of the six configs describes it, before it is anything of TinyCorp's. */
interface ParsedServer {
  name: string
  /** What the file says it is, including the ones TinyCorp cannot carry. */
  kind: McpTransport | 'sse' | 'unknown'
  /** What the file said, when `kind` is `unknown`, so the row can say what was refused. */
  said: string
  url: string
  command: string
  args: string[]
  /** Every environment value: TinyCorp cannot tell which half of it is secret, so none is stored. */
  env: Record<string, string>
  /** The headers an `http` server carries, `authorization` among them. */
  headers: Record<string, string>
}

export interface McpSources {
  /**
   * Reads every source and groups what it finds, with `taken` — the names the catalogue already
   * holds — marking the rows that are in already. The values found are held here, and a second
   * scan replaces them.
   */
  scan(taken: readonly string[]): McpFoundGroup[]
  /**
   * What the catalogue is given for one found server: its fields, and its secrets, write-only.
   * Null for a source and name the last scan did not offer, which is how a renderer that asks for
   * something else gets nothing rather than something.
   */
  take(source: McpSource, name: string): McpServerInput | null
}

export interface McpSourcesOptions {
  /** The boss's environment. `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and the XDG variables move files. */
  env?: NodeJS.ProcessEnv
  /** Which OS's paths to resolve. Injected so one test covers all three. */
  platform?: NodeJS.Platform
  /** Reads the file, or returns null when it is not there. Injected so a test needs no home. */
  readFile?: (path: string) => string | null
}

/**
 * Where each tool keeps the boss's own MCP servers, on this OS — whether or not the file is there.
 *
 * macOS and Linux differ in one place each and Windows in most of them, so every path is resolved
 * here rather than assumed: `%APPDATA%` on Windows, `$XDG_CONFIG_HOME` (falling back to
 * `~/.config`) on Linux, and `~/Library/Application Support` on macOS.
 */
export function mcpSourcePath(
  source: McpSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env['HOME'] ?? env['USERPROFILE'] ?? homedir()
  switch (source) {
    case 'claude-code':
      return join(env['CLAUDE_CONFIG_DIR']?.trim() || home, '.claude.json')
    case 'codex':
      return join(env['CODEX_HOME']?.trim() || join(home, '.codex'), 'config.toml')
    case 'opencode':
      return join(configHome(env, platform, home), 'opencode', 'opencode.json')
    case 'claude-desktop':
      return join(appSupport(env, platform, home), 'Claude', 'claude_desktop_config.json')
    case 'cursor':
      return join(home, '.cursor', 'mcp.json')
    case 'vscode':
      return join(appSupport(env, platform, home), 'Code', 'User', 'mcp.json')
  }
}

/**
 * Where a cross-platform app keeps its per-user settings: `%APPDATA%` on Windows, `Application
 * Support` on macOS, and the XDG config home on Linux — which is what Electron's own `userData`
 * resolves to, so Claude Desktop and VS Code are found where they really are.
 */
function appSupport(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') return env['APPDATA']?.trim() || join(home, 'AppData', 'Roaming')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  return configHome(env, platform, home)
}

/** The XDG config home, which OpenCode uses on every platform it runs on. */
function configHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const xdg = env['XDG_CONFIG_HOME']?.trim()
  if (xdg) return xdg
  if (platform === 'win32') return env['APPDATA']?.trim() || join(home, 'AppData', 'Roaming')
  return join(home, '.config')
}

export function createMcpSources({
  env = process.env,
  platform = process.platform,
  readFile = readIfThere,
}: McpSourcesOptions = {}): McpSources {
  /** The values of the last scan, by source and name. Nothing else in the app can reach them. */
  let held = new Map<string, McpServerInput>()

  return {
    scan(taken) {
      held = new Map()
      return MCP_SOURCES.map((source) => {
        const path = mcpSourcePath(source, env, platform)
        const servers = readSource(source, readFile(path)).map((parsed) => {
          const { found, input } = foundOf(parsed, taken)
          if (input) held.set(`${source}\u0000${parsed.name}`, input)
          return found
        })
        return { source, path, servers }
      }).filter((group) => group.servers.length > 0)
    },

    take: (source, name) => held.get(`${source}\u0000${name}`) ?? null,
  }
}

/** One source's servers, in the file's own order. A file that will not parse holds none. */
export function readSource(source: McpSource, text: string | null): ParsedServer[] {
  if (text === null) return []
  switch (source) {
    case 'codex':
      return readCodex(text)
    case 'opencode':
      return readOpencode(text)
    case 'claude-code':
      return readClaudeCode(text)
    case 'vscode':
      return readClaudeStyle(text, 'servers')
    default:
      return readClaudeStyle(text, 'mcpServers')
  }
}

/**
 * Claude Code's own config, user scope first and then every project's.
 *
 * A project may configure a server the user scope does not have — which is most of them, since
 * `claude mcp add` writes the project by default — so both are read. A name the user scope
 * already used is not listed twice: the two are the same tool as far as this list is concerned,
 * and the boss is choosing a name for the Company, not reading an audit of their own machine.
 */
function readClaudeCode(raw: string): ParsedServer[] {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return []
  const found = entriesOf(parsed['mcpServers']).map(([name, entry]) => claudeEntry(name, entry))
  const seen = new Set(found.map((server) => server.name))
  const projects = isRecord(parsed['projects']) ? Object.values(parsed['projects']) : []
  for (const project of projects) {
    if (!isRecord(project)) continue
    for (const [name, entry] of entriesOf(project['mcpServers'])) {
      if (seen.has(name)) continue
      seen.add(name)
      found.push(claudeEntry(name, entry))
    }
  }
  return found
}

/** Claude Desktop, Cursor and VS Code all write the shape Claude Code does, under their own key. */
function readClaudeStyle(raw: string, key: string): ParsedServer[] {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return []
  return entriesOf(parsed[key]).map(([name, entry]) => claudeEntry(name, entry))
}

function claudeEntry(name: string, entry: Record<string, unknown>): ParsedServer {
  const said = text(entry['type'])
  const url = text(entry['url'])
  return {
    name,
    kind: kindOf(said, url),
    said,
    url,
    command: text(entry['command']),
    args: list(entry['args']),
    env: record(entry['env']),
    headers: record(entry['headers']),
  }
}

/**
 * Codex keeps its servers in TOML, under `[mcp_servers.<name>]`. It names an `http` server's
 * token by the *variable* it is in rather than holding the value, so there is nothing of it here
 * to carry across: the row says `http` and comes over without a token, which is the honest answer
 * and what the boss then types in once.
 */
function readCodex(raw: string): ParsedServer[] {
  let parsed: unknown
  try {
    parsed = parseToml(raw)
  } catch {
    // Codex owns that file and the boss edits it by hand; a line this parser refuses is a config
    // with nothing to offer, not a crash in Company settings.
    return []
  }
  if (!isRecord(parsed)) return []
  return entriesOf(parsed['mcp_servers']).map(([name, entry]) => {
    const url = text(entry['url'])
    return {
      name,
      kind: kindOf(text(entry['transport']), url),
      said: text(entry['transport']),
      url,
      command: text(entry['command']),
      args: list(entry['args']),
      env: record(entry['env']),
      headers: record(entry['http_headers']),
    }
  })
}

/** OpenCode's config: `mcp`, with `local` for a command and `remote` for a URL. */
function readOpencode(raw: string): ParsedServer[] {
  const parsed = parseJson(raw)
  if (!isRecord(parsed)) return []
  return entriesOf(parsed['mcp']).map(([name, entry]) => {
    const kind = text(entry['type'])
    const command = list(entry['command'])
    return {
      name,
      kind: kind === 'remote' ? 'http' : kind === 'local' ? 'stdio' : 'unknown',
      said: kind,
      url: text(entry['url']),
      command: command[0] ?? '',
      args: command.slice(1),
      env: record(entry['environment']),
      headers: record(entry['headers']),
    }
  })
}

/** What a Claude-style or Codex entry is: what it says, or what its fields say when it says nothing. */
function kindOf(said: string, url: string): ParsedServer['kind'] {
  if (said === 'http' || said === 'stdio' || said === 'sse') return said
  if (said === 'streamable_http' || said === 'streamable-http') return 'http'
  if (said !== '') return 'unknown'
  return url ? 'http' : 'stdio'
}

/**
 * One parsed server as the row draws it, and — when it can be added at all — the input the
 * catalogue would take. A `stdio` server's whole environment is treated as secret, because
 * TinyCorp cannot tell which half of it is: nothing of it goes in the Company database, and only
 * the variable names are ever shown (T235).
 */
function foundOf(
  parsed: ParsedServer,
  taken: readonly string[],
): { found: McpFoundServer; input: McpServerInput | null } {
  const http = parsed.kind === 'http'
  const token = bearerIn(parsed.headers)
  const named = namedHeaders(parsed.headers)
  const added = taken.some((other) => other.toLowerCase() === parsed.name.toLowerCase())
  const problem = kindProblem(parsed) ?? nameProblem(parsed.name) ?? fieldProblem(parsed) ?? headerProblem(parsed)

  const found: McpFoundServer = {
    name: parsed.name,
    transport: http ? 'http' : 'stdio',
    target: http ? parsed.url : [parsed.command, ...parsed.args].filter(Boolean).join(' '),
    secretNames: http ? Object.keys(named) : Object.keys(parsed.env),
    hasToken: http && token !== null,
    added,
    problem,
  }
  if (problem !== null || added) return { found, input: null }

  const input: McpServerInput = http
    ? {
        name: parsed.name,
        transport: 'http',
        url: parsed.url,
        ...(token !== null && { secret: token }),
        ...(Object.keys(named).length > 0 && { headerSecrets: named }),
      }
    : {
        name: parsed.name,
        transport: 'stdio',
        command: parsed.command,
        args: parsed.args,
        env: {},
        secrets: parsed.env,
      }
  return { found, input }
}

/** A transport TinyCorp has no way to spawn or call is listed and refused, never guessed at. */
function kindProblem(parsed: ParsedServer): string | null {
  if (parsed.kind === 'sse') return 'sse — TinyCorp carries http and stdio'
  if (parsed.kind === 'unknown') return `${parsed.said || 'unknown'} — TinyCorp carries http and stdio`
  return null
}

/** The name, in the catalogue's own words. A collision is not a problem here — it is `added`. */
function nameProblem(name: string): string | null {
  return mcpServerProblems({ name, transport: 'stdio', command: 'x' }, []).name ?? null
}

function fieldProblem(parsed: ParsedServer): string | null {
  if (parsed.kind === 'http') return parsed.url ? null : 'no url'
  return parsed.command ? null : 'no command'
}

/**
 * A header-authenticated server is added with its headers now (T245): the catalogue keeps their
 * names and the OS store keeps their values. What is still refused is a header **name** the
 * catalogue cannot carry — one an adapter would have to quote into a config key.
 */
function headerProblem(parsed: ParsedServer): string | null {
  if (parsed.kind !== 'http') return null
  const odd = Object.keys(namedHeaders(parsed.headers)).filter((name) => !isMcpHeaderName(name))
  if (odd.length === 0) return null
  return `${odd.join(', ')} — not a header name TinyCorp can carry`
}

/**
 * The headers besides the bearer one, whose values all go to the OS store: this is somebody else's
 * config and TinyCorp cannot tell which half of it is private, so none of it reaches the Company
 * database and only the names are ever shown (T235's rule, applied to headers in T245).
 */
function namedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== BEARER_HEADER))
}

/** The bearer token of an `authorization` header, or null. The header name's case is the file's. */
function bearerIn(headers: Record<string, string>): string | null {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')
  if (!found) return null
  return found[1].trim().replace(/^Bearer\s+/i, '') || null
}

/**
 * These files belong to other programs, which may write anything into them. Two of them are JSON
 * with comments — VS Code's `mcp.json` ships commented, and Cursor's is edited by hand — so the
 * comments and any trailing comma come out before `JSON.parse` sees it. A file that still will
 * not parse holds nothing to offer, which is not a crash in Company settings.
 */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(withoutComments(raw).replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}

/** `//` and `/* *\/` comments, outside strings. A scanner rather than a regex, because a URL in
 * a string holds `//` and a regex has no way to know it is inside quotes. */
function withoutComments(raw: string): string {
  let out = ''
  let inString = false
  for (let at = 0; at < raw.length; at += 1) {
    const here = raw[at]
    const next = raw[at + 1]
    if (inString) {
      out += here
      if (here === '\\') {
        out += next ?? ''
        at += 1
      } else if (here === '"') inString = false
      continue
    }
    if (here === '"') {
      inString = true
      out += here
      continue
    }
    if (here === '/' && next === '/') {
      while (at < raw.length && raw[at] !== '\n') at += 1
      out += '\n'
      continue
    }
    if (here === '/' && next === '*') {
      at += 2
      while (at < raw.length && !(raw[at] === '*' && raw[at + 1] === '/')) at += 1
      at += 1
      continue
    }
    out += here
  }
  return out
}

/** The entries of a record of records, in the file's own order. Anything else holds none. */
function entriesOf(value: unknown): [string, Record<string, unknown>][] {
  if (!isRecord(value)) return []
  return Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
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
