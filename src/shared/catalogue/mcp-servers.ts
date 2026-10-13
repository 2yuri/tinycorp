/**
 * The Company's catalogue of MCP servers from outside TinyCorp (T136, frame `uApL8`).
 *
 * A Session is handed the Company's own server and nothing else unless the boss says otherwise:
 * every Provider is spawned with its strictest MCP flag, so an Employee never inherits what the
 * boss has in their own Claude Code, Codex or OpenCode config. This catalogue is how more is
 * granted on purpose — typed in once, here, and handed out through the role (decision 57).
 */

import { machineWords, secretStoreShort } from '../platform/machine-words'

/** How a server is reached: an HTTP endpoint, or a command TinyCorp spawns in the Employee's folder. */
export const MCP_TRANSPORTS = ['http', 'stdio'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/**
 * The key the Company's own server is written under in every Session's config. A catalogue server
 * may not take it: the Employee's hands are not something the boss can shadow by accident.
 */
export const COMPANY_MCP_NAME = 'company'

/** What a name may hold: it becomes a key in a config file and a tool prefix in the Session. */
export const MCP_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export const MAX_MCP_NAME_LENGTH = 40

/**
 * What a header's **name** may hold (T245). Narrower than HTTP's own token, on purpose: a header
 * name is written into a TOML key path by one adapter (`mcp_servers.x.http_headers.<name>`), so it
 * has to be a bare key there — letters, digits, `-` and `_`. `DD_API_KEY`, `DD_APPLICATION_KEY`,
 * `SIGNOZ-API-KEY` and `X-SigNoz-URL` — every header a real server asks for — are all inside it,
 * and a server that wants one outside it is refused by name rather than written half-quoted.
 */
export const MCP_HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Whether this is a header name TinyCorp will carry, said in one place so every caller agrees. */
export function isMcpHeaderName(name: string): boolean {
  return MCP_HEADER_PATTERN.test(name)
}

/**
 * The one header no catalogue server may name: a bearer token is {@link McpServer.secretEnv}'s
 * `http` twin and is stored as the server's own secret, so a second one under a header of the same
 * name would be two answers to one question.
 */
export const BEARER_HEADER = 'authorization'

/** One server in the Company's catalogue. Its secret is never part of it. */
export interface McpServer {
  id: string
  /** Unique in the Company, and the key the adapters write it under. */
  name: string
  transport: McpTransport
  /** `http`: where the server is. Empty for a `stdio` server. */
  url: string
  /** `stdio`: the command TinyCorp spawns. Empty for an `http` server. */
  command: string
  /** `stdio`: the command's arguments. */
  args: string[]
  /** `stdio`: extra environment for the command. Never a secret — those go in the keychain. */
  env: Record<string, string>
  /**
   * `stdio`: the environment variable the keychain secret arrives under. An `http` server's
   * secret is always a bearer token, so it names none.
   */
  secretEnv: string
  /**
   * `stdio`: the names of further environment variables whose **values** are in the OS secret
   * store, one entry each. This is how an imported server travels (T235): TinyCorp cannot know
   * which of a server's environment values are secret, so none of them is written to the Company
   * database — only their names are, and they are all this list holds.
   */
  secretNames: string[]
  /**
   * `http`: headers the server is called with, whose values are plain text (T245). A server that
   * wants to be told where its own instance is — SigNoz's `X-SigNoz-URL` — says it here, and the
   * value is in the Company database like the URL beside it, because there is nothing private in
   * it. Anything private is a {@link headerSecretNames} instead.
   */
  headers: Record<string, string>
  /**
   * `http`: the names of the headers whose **values** are in the OS secret store, one entry each
   * (T245). This is the `http` twin of {@link secretNames}: a server that authenticates with named
   * headers rather than a bearer token — Datadog's `DD_API_KEY` and `DD_APPLICATION_KEY`, SigNoz's
   * `SIGNOZ-API-KEY` — keeps every one of those values out of the Company database, and only the
   * names are here.
   */
  headerSecretNames: string[]
}

/** A catalogue row as the settings card draws it: the server, plus what is true about it now. */
export interface McpServerRow extends McpServer {
  /** Whether a secret for this server is in the OS keychain. Never the secret itself. */
  hasSecret: boolean
  /** How many Employees hold this server now. */
  employees: number
}

/**
 * What the add and edit forms send. `secret` is write-only: a string stores it in the keychain,
 * `null` forgets it, and leaving it out keeps whatever is there. Nothing ever reads it back.
 */
export interface McpServerInput {
  name: string
  transport: McpTransport
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  secretEnv?: string
  secret?: string | null
  /**
   * `stdio`: named values that go to the OS secret store, write-only like {@link secret}. Giving
   * it replaces the whole set — a name that is not in it is forgotten — and leaving it out keeps
   * whatever is stored. Nothing ever reads one back.
   */
  secrets?: Record<string, string>
  /** `http`: plain-text headers, stored as they are. Nothing private may go in one (T245). */
  headers?: Record<string, string>
  /**
   * `http`: header values that go to the OS secret store, write-only like {@link secrets} and
   * replacing the whole set the same way (T245).
   */
  headerSecrets?: Record<string, string>
}

/** What removing a server takes with it, counted before it is done. */
export interface McpServerImpact {
  /** The server's name, so the confirmation can say it. */
  name: string
  /** Employees that hold it now and would lose it. */
  employees: number
  /** Roles that hand it out and would stop. */
  roles: number
}

/** The fields a form can be wrong about, with the sentence each one is wrong in. */
export type McpServerProblems = Partial<Record<'name' | 'url' | 'command' | 'secretEnv', string>>

/**
 * What is wrong with a server, as the form shows it and the engine refuses it. One function, so
 * the boss never reads one sentence in the form and a different one from the engine.
 */
export function mcpServerProblems(
  input: Pick<McpServerInput, 'name' | 'transport' | 'url' | 'command' | 'secretEnv'>,
  taken: readonly string[] = [],
): McpServerProblems {
  const problems: McpServerProblems = {}
  const name = (input.name ?? '').trim()
  if (!name) problems.name = 'A server needs a name'
  else if (name.length > MAX_MCP_NAME_LENGTH) problems.name = `A name is at most ${MAX_MCP_NAME_LENGTH} characters`
  else if (!MCP_NAME_PATTERN.test(name))
    problems.name = 'Lower case letters, digits, - and _, starting with a letter or digit'
  else if (name === COMPANY_MCP_NAME) problems.name = `\`${COMPANY_MCP_NAME}\` is the Company's own server`
  else if (taken.some((other) => other.toLowerCase() === name.toLowerCase())) {
    problems.name = `This Company already has a server named ${name}`
  }

  if (input.transport === 'http') {
    const url = (input.url ?? '').trim()
    if (!url) problems.url = 'An http server needs a URL'
    else if (!/^https?:\/\/\S+$/i.test(url)) problems.url = 'A URL starts with http:// or https://'
  } else if (!(input.command ?? '').trim()) {
    problems.command = 'A stdio server needs a command'
  }

  const secretEnv = (input.secretEnv ?? '').trim()
  if (secretEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretEnv)) {
    problems.secretEnv = 'An environment variable name, e.g. GITHUB_TOKEN'
  }
  return problems
}

/** The mono line under a server's name: where it is, or what it runs. */
export function mcpTarget(server: Pick<McpServer, 'transport' | 'url' | 'command' | 'args'>): string {
  if (server.transport === 'http') return server.url
  return [server.command, ...server.args].filter(Boolean).join(' ')
}

/**
 * What the row says about the server's secrets. It never shows a value, and there is no read-back:
 * a server the boss typed in carries one token, an imported one carries a value per environment
 * variable it named (T235) and a header-authenticated one a value per header (T245), so the line
 * counts rather than promising a single token.
 */
export function secretLine(
  server: Pick<McpServerRow, 'hasSecret' | 'secretNames' | 'headerSecretNames'>,
  platform: NodeJS.Platform | string = 'darwin',
): string {
  const stored = (server.hasSecret ? 1 : 0) + server.secretNames.length + server.headerSecretNames.length
  if (stored === 0) return 'No secret'
  const where = secretStoreShort(platform)
  if (stored === 1 && server.hasSecret) return `Token in ${where}`
  return `${stored} ${stored === 1 ? 'value' : 'values'} in ${where}`
}

/** What the row says about who holds the server. */
export function holdersLine(employees: number): string {
  if (employees === 0) return 'No employees'
  return employees === 1 ? '1 employee' : `${employees} employees`
}

/**
 * The sentence the boss reads before a server is removed. It says what goes with it, because the
 * grant is taken off every Employee and every role that held it.
 */
export function removalLine(impact: McpServerImpact): string {
  const parts = [
    impact.employees === 1 ? '1 Employee' : `${impact.employees} Employees`,
    impact.roles === 1 ? '1 role' : `${impact.roles} roles`,
  ]
  return `${impact.name} is held by ${parts[0]} and handed out by ${parts[1]}. Removing it takes the grant off all of them.`
}

/** What a `stdio` server is, said plainly, because adding one is choosing to run a command. */
export function stdioWarning(platform: string): string {
  return (
    `A stdio server is a command TinyCorp spawns in the Employee’s folder, with its own access to ${machineWords(platform).machine}. ` +
    'TinyCorp does not fetch, install or resolve it — the command is yours, and it runs the first time an ' +
    'Employee that holds it starts.'
  )
}

/**
 * What the Integrations card says the MCP servers are. It names the product whose own config the
 * boss is most likely to be thinking of, as frame `uApL8` writes it and `skills.ts` does beside it.
 */
export const MCP_CARD_SUB =
  'Tools from outside TinyCorp. An Employee is handed only the ones you give it — never the servers in your own ' +
  'Claude Code config.'
