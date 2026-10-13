import {
  type McpServer,
  type McpServerInput,
  type McpServerProblems,
  type McpServerRow,
  type McpTransport,
  mcpServerProblems,
} from '../../../shared/catalogue/mcp-servers'
import { secretStoreName } from '../../../shared/platform/machine-words'
import { hostPlatform } from '../chrome'

/**
 * The Add / Edit MCP server form as pure data (T136, frame `uApL8`): what the controls hold, and
 * the input the Save button sends. The secret is write-only everywhere it appears here — nothing
 * reads one back, so the form opens with an empty box over a server that already has one.
 */
export interface McpDraft {
  name: string
  transport: McpTransport
  url: string
  /** The command and its arguments, as one line, the way the row shows it. */
  command: string
  /** `NAME=value` per line. */
  env: string
  secretEnv: string
  /** Typed now, sent once; never filled from what is stored. */
  secret: string
  /** True while a stored secret is to be kept as it is — the boss has not touched the box. */
  keepSecret: boolean
}

export function blankDraft(): McpDraft {
  return { name: '', transport: 'http', url: '', command: '', env: '', secretEnv: '', secret: '', keepSecret: false }
}

/** The draft that edits a server. The secret box starts empty and untouched, because it is unreadable. */
export function draftOf(server: McpServer & { hasSecret: boolean }): McpDraft {
  return {
    name: server.name,
    transport: server.transport,
    url: server.url,
    command: [server.command, ...server.args].filter(Boolean).join(' '),
    env: Object.entries(server.env)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
    secretEnv: server.secretEnv,
    secret: '',
    keepSecret: server.hasSecret,
  }
}

/** What Save sends. `secret` is left out entirely when the boss did not touch the box. */
export function mcpInput(draft: McpDraft): McpServerInput {
  const [command = '', ...args] = splitCommand(draft.command)
  return {
    name: draft.name.trim(),
    transport: draft.transport,
    url: draft.url.trim(),
    command,
    args,
    env: parseEnv(draft.env),
    secretEnv: draft.secretEnv.trim(),
    ...(draft.keepSecret ? {} : { secret: draft.secret.trim() || null }),
  }
}

/** What is wrong with the draft, in the engine's own words; empty when Save may be pressed. */
export function draftProblems(draft: McpDraft, servers: McpServerRow[], editingId?: string): McpServerProblems {
  const [command = ''] = splitCommand(draft.command)
  return mcpServerProblems(
    { name: draft.name, transport: draft.transport, url: draft.url, command, secretEnv: draft.secretEnv },
    servers.filter((server) => server.id !== editingId).map((server) => server.name),
  )
}

export function canSave(draft: McpDraft, servers: McpServerRow[], editingId?: string): boolean {
  return Object.keys(draftProblems(draft, servers, editingId)).length === 0
}

/** A command line split on whitespace; quotes are not a shell, so an argument with spaces is quoted. */
export function splitCommand(line: string): string[] {
  return (line.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) =>
    /^(".*"|'.*')$/.test(part) ? part.slice(1, -1) : part,
  )
}

/** `NAME=value` per line; blank lines and lines without an `=` are dropped. */
export function parseEnv(text: string): Record<string, string> {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=')
      return at === -1 ? null : ([line.slice(0, at).trim(), line.slice(at + 1).trim()] as const)
    })
    .filter((entry): entry is readonly [string, string] => entry !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]))
  return Object.fromEntries(entries)
}

/** What the secret box says it will do when the form is saved. */
export function secretHelper(draft: McpDraft, platform: string = hostPlatform()): string {
  const store = secretStoreName(platform)
  if (draft.keepSecret) return `A token is in ${store}. Type a new one to replace it, or clear it below.`
  if (draft.secret.trim()) return `Stored in ${store}, never in the Company database.`
  return `Optional. It goes in ${store}, and nothing here ever shows it again.`
}
