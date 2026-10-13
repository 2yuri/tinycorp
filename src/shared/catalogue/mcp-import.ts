/**
 * Importing the boss's own MCP servers into the Company's catalogue (T235, frame `qSIIY`).
 *
 * An Employee is handed only what the catalogue grants it — every Provider is spawned with its
 * strictest MCP flag (T136) — so the servers the boss already has in their own Claude Code are
 * invisible to the whole Company until somebody types them in again. This is the shortcut: read
 * that config in the main process, list what is in it by name, and let the boss tick what this
 * Company gets.
 *
 * **Not one value crosses.** The preview the renderer is handed carries names only, exactly as
 * the Import .env preview does (T176): the main process holds the values it parsed and hands them
 * straight to the OS secret store when the boss presses Import. The boss's own config file is
 * only ever read.
 */

import type { Provider } from '../domain/providers'
import { machineWords } from '../platform/machine-words'
import type { McpTransport } from './mcp-servers'

/**
 * The Providers whose own MCP config TinyCorp can read, in the order the card offers them.
 *
 * It is a list rather than a single product because the second one is a reader and a line here:
 * the screens draw a button per entry and take its name from the Provider catalogue, so no screen
 * names a product (`no-provider-names.test.ts`). Codex keeps its servers in TOML and OpenCode in
 * its own JSON; neither is here until something in `src/main` can read it.
 */
export const MCP_IMPORT_PROVIDERS: readonly Provider[] = ['claude']

/** One server found in the boss's own config, as the dialog draws it. No value is part of this. */
export interface McpImportCandidate {
  /** The key it has in the boss's config, which is the name it would take in the catalogue. */
  name: string
  transport: McpTransport
  /** `http`: the URL. `stdio`: the command and its arguments, as one line. */
  target: string
  /**
   * The names of the values that would go to the OS secret store — never a value, and never the
   * value's shape. A `stdio` server's environment variables, and an `http` server's headers beside
   * its bearer token (T245): a Datadog or a SigNoz in the boss's own config comes across with
   * `DD_API_KEY` or `SIGNOZ-API-KEY` named here and its value going straight to the store.
   */
  secretNames: string[]
  /** Whether a bearer token came with it, for an `http` server. Never the token. */
  hasToken: boolean
  /** Ticked when the dialog opens. A server that cannot be imported never is. */
  chosen: boolean
  /** Why it cannot be imported at all, or null. A row with one is not tickable. */
  problem: string | null
}

/** What the dialog shows: where it read, and what it found. */
export interface McpImportPreview {
  /** The Provider whose config was read. Its name comes from the Provider catalogue. */
  source: Provider
  /** The file that was read, as the boss sees it: `~/.claude.json`. */
  path: string
  servers: McpImportCandidate[]
}

/** The line under a server that names the variables its values are kept under. Names only. */
export function importSecretLine(candidate: Pick<McpImportCandidate, 'secretNames'>, platform: string): string {
  if (candidate.secretNames.length === 0) return ''
  return `${candidate.secretNames.join(', ')} → ${machineWords(platform).secretStore}`
}

/** What a row says on the right: why it is refused, or what comes across with it. */
export function importNote(candidate: McpImportCandidate, platform: string): string {
  if (candidate.problem) return candidate.problem
  return candidate.hasToken ? `bearer token → ${machineWords(platform).secretStore}` : ''
}

/** The Import button's label, which counts what is ticked. */
export function importButtonLabel(chosen: number): string {
  if (chosen === 0) return 'Import'
  return chosen === 1 ? 'Import 1 server' : `Import ${chosen} servers`
}

/** What the dialog's head says under its title. */
export const MCP_IMPORT_SUB = 'The servers in your own config. Tick the ones this Company gets.'

/** The strip at the foot of the list: where the values go, and what is left alone. */
export function mcpImportNote(platform: string): string {
  return (
    `Env values and tokens go straight to ${machineWords(platform).secretStore}, never into the Company database. Only their ` +
    'names are shown here, and your own config is left as it is.'
  )
}

/** What the dialog says instead of a list when the config holds no server at all. */
export function mcpImportEmpty(product: string): string {
  return `There are no MCP servers in your own ${product} config, so there is nothing to import.`
}

/** How many servers were found, as the head's right-hand count says it. */
export function importCountLine(found: number): string {
  return found === 1 ? '1 server' : `${found} servers`
}
