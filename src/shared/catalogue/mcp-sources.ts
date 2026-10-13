/**
 * The MCP servers already configured in the boss's own tools, as the Integrations tab lists them
 * (T242, frame `mPqN9`).
 *
 * T235 gave the boss one button and one product to press it for. This is the same idea without
 * the button: when the tab opens, every tool on this machine that keeps MCP servers in a file is
 * read, and what is in them is a row the boss can add in one click. Reading is in the main
 * process and read-only — TinyCorp never writes one of these files.
 *
 * **Not one value crosses.** A group carries names only, exactly as the import preview does
 * (T235) and the Import .env preview before it (T176): the values stay in the main process and
 * go from there to the OS secret store.
 */

import { machineWords } from '../platform/machine-words'
import type { McpTransport } from './mcp-servers'

/**
 * The tools whose own MCP configuration TinyCorp can read.
 *
 * It is a list, and a reader is one entry here plus one case in `main/features/catalogue/
 * mcp-sources.ts`. Three of them are Providers and three are not, which is why this is its own
 * catalogue rather than `MCP_IMPORT_PROVIDERS`: what a Session is spawned with and what the boss
 * happens to have installed are two different questions.
 */
export const MCP_SOURCES = ['claude-code', 'codex', 'opencode', 'claude-desktop', 'cursor', 'vscode'] as const

export type McpSource = (typeof MCP_SOURCES)[number]

/**
 * What each source is called, in its own words. It lives here rather than in the screen because
 * three of these are Providers, and no renderer file may name one (`no-provider-names.test.ts`).
 */
export const MCP_SOURCE_LABEL: Record<McpSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
}

/** One server found in a tool's own config, as the row draws it. No value is part of this. */
export interface McpFoundServer {
  /** The key it has in that config, which is the name it would take in the catalogue. */
  name: string
  transport: McpTransport
  /** `http`: the URL. `stdio`: the command and its arguments, as one line. */
  target: string
  /**
   * The names of the values that would go to the OS secret store — never a value, and never the
   * value's shape. A `stdio` server's environment variables, and an `http` server's headers beside
   * its bearer token (T245).
   */
  secretNames: string[]
  /** Whether a bearer token came with it, for an `http` server. Never the token. */
  hasToken: boolean
  /** This Company already has a server under this name, so the row says so instead of adding. */
  added: boolean
  /** Why it cannot be added at all, or null. A row with one offers no button. */
  problem: string | null
}

/** One tool's servers, as the section groups them. */
export interface McpFoundGroup {
  source: McpSource
  /** The file that was read, as the boss sees it: `~/.claude.json`. */
  path: string
  servers: McpFoundServer[]
}

/** What the card says it is. */
export function mcpFoundSub(platform: string): string {
  const words = machineWords(platform)
  return (
    `The MCP servers already configured in the tools on ${words.machine}. TinyCorp reads those files and never writes them; ` +
    `adding one copies it here, with its values going straight to ${words.secretStore}.`
  )
}

/** What the card says when no tool on this machine has an MCP server in it. */
export const MCP_FOUND_EMPTY =
  'Nothing found. The tools TinyCorp can read either have no MCP servers in them or are not installed here.'

/** The count at the right of a group's label. */
export function foundCountLine(servers: readonly McpFoundServer[]): string {
  return servers.length === 1 ? '1 server' : `${servers.length} servers`
}

/** What a found row says on its right when it cannot be added: the reason, or nothing. */
export function foundNote(server: McpFoundServer, platform: string): string {
  if (server.problem) return server.problem
  if (server.added) return 'Added'
  return server.hasToken ? `bearer token → ${machineWords(platform).secretStore}` : ''
}

/** The line under a found server naming the variables its values are kept under. Names only. */
export function foundSecretLine(server: Pick<McpFoundServer, 'secretNames'>, platform: string): string {
  if (server.secretNames.length === 0) return ''
  return `${server.secretNames.join(', ')} → ${machineWords(platform).secretStore}`
}

/** How many servers were found across every source, for the tab's count line. */
export function foundTotal(groups: readonly McpFoundGroup[]): number {
  return groups.reduce((total, group) => total + group.servers.length, 0)
}

/** What the search field matches on a found row: its name and where it runs. */
export function foundMatches(server: McpFoundServer, source: McpSource, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  return `${server.name} ${server.target} ${MCP_SOURCE_LABEL[source]}`.toLowerCase().includes(wanted)
}
