import type { McpImportPreview } from '../../../shared/catalogue/mcp-import'
import { MCP_PRESETS, type McpPreset, presetInput, presetProblems } from '../../../shared/catalogue/mcp-presets'
import type { McpServerInput, McpServerRow } from '../../../shared/catalogue/mcp-servers'
import { MCP_SOURCES, type McpFoundGroup, type McpSource } from '../../../shared/catalogue/mcp-sources'
import { mcpChannels } from '../../../shared/domain/channels'
import { PROVIDERS, type Provider } from '../../../shared/domain/providers'
import { attempt, type IpcHandlerRegistry } from '../../core'
import { createMcpImporters, type McpImporter } from './mcp-import'
import { createMcpSources, type McpSources } from './mcp-sources'
import type { McpFacade } from './wire'

export interface McpIpcOptions {
  ipc: IpcHandlerRegistry
  engine: McpFacade
  broadcastChanged(): void
  /**
   * Where an import reads from, per Provider (T235). Injected so a test needs no `~/.claude.json`,
   * and kept here rather than in the engine because the values it parses must never reach a
   * renderer: they go from this process's memory to the OS store and nowhere else. A Provider
   * with no reader is refused by name, rather than answering with an empty list.
   */
  importers?: Partial<Record<Provider, McpImporter>>
  /**
   * What the tab reads when it opens (T242). Injected for the same reason the importers are: the
   * values it parses go from this process's memory to the OS store and nowhere else, so a test
   * proving that needs its own reader rather than the boss's home folder.
   */
  sources?: McpSources
}

/**
 * The Company's MCP catalogue, for Company settings → Integrations (T136).
 *
 * Only the renderer reaches it: adding, editing and removing a server is the boss's, the way
 * deleting a channel is (T112). Nothing here returns a secret — `add` and `update` take one and
 * hand it to the keychain, and what comes back says only whether there is one.
 */
export function registerMcpIpc({
  ipc,
  engine,
  broadcastChanged,
  importers = createMcpImporters(),
  sources = createMcpSources(),
}: McpIpcOptions): void {
  engine.mcp.onChange(broadcastChanged)

  ipc.handle(mcpChannels.list, () => attempt(() => engine.mcp.list()))
  ipc.handle(mcpChannels.add, (_event, input) => attempt(() => engine.mcp.create(serverInput(input, true))))
  ipc.handle(mcpChannels.update, (_event, id, patch) =>
    attempt(() => engine.mcp.update(requireId(id), serverInput(patch, false))),
  )
  ipc.handle(mcpChannels.impact, (_event, id) => attempt(() => engine.mcp.impact(requireId(id))))
  ipc.handle(mcpChannels.remove, (_event, id) =>
    attempt(() => {
      engine.mcp.remove(requireId(id))
      return null
    }),
  )

  // The scan is what the boss's own config holds, by name. The values it found stay in the
  // importer; this answer carries none of them, and neither does the import that follows.
  ipc.handle(mcpChannels.importScan, (_event, provider) =>
    attempt((): McpImportPreview => readerFor(provider).scan(names())),
  )
  ipc.handle(mcpChannels.importServers, (_event, provider, chosen) =>
    attempt((): McpServerRow[] => {
      const importer = readerFor(provider)
      // Every name is resolved before any of them is created, so a list with one bad name in it
      // leaves the catalogue exactly as it was rather than half imported.
      const taken = new Set(names().map((name) => name.toLowerCase()))
      const inputs = requireNames(chosen).map((name) => {
        const input = importer.take(name)
        if (!input) throw new Error(`${name} is not one of the servers just read`)
        if (taken.has(name.toLowerCase())) throw new Error(`This Company already has a server named ${name}`)
        taken.add(name.toLowerCase())
        return input
      })
      return inputs.map((input) => engine.mcp.create(input))
    }),
  )

  // What the tools on this machine already have, by name. The values stay in the reader; this
  // answer carries none of them, and neither does the add that follows.
  ipc.handle(mcpChannels.found, () => attempt((): McpFoundGroup[] => sources.scan(names())))
  ipc.handle(mcpChannels.addFound, (_event, source, name) =>
    attempt((): McpServerRow => {
      const input = sources.take(requireSource(source), requireText(name, 'server'))
      if (!input) throw new Error(`${String(name)} is not one of the servers just found`)
      return engine.mcp.create(input)
    }),
  )

  // A preset the boss filled in. `values` holds what they typed — the secrets among them — and it
  // goes straight through to the catalogue, which hands it to the OS store. Nothing reads it back.
  ipc.handle(mcpChannels.addPreset, (_event, presetId, name, values) =>
    attempt((): McpServerRow => {
      const preset = presetFor(presetId)
      const chosen = requireText(name, 'name').trim() || preset.server
      const filled = requireValues(values)
      const problems = presetProblems(preset, chosen, filled, names())
      const first = Object.values(problems)[0]
      if (first) throw new Error(first)
      return engine.mcp.create(presetInput(preset, chosen, filled))
    }),
  )

  /** The names the catalogue already holds, which is what an import may not collide with. */
  function names(): string[] {
    return engine.mcp.list().map((server) => server.name)
  }

  /** The reader for one Provider, or a refusal that says there is none rather than a blank list. */
  function readerFor(provider: unknown): McpImporter {
    if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
      // Not "…to import from": a string that ends in `import from"` is read as a static import by
      // the ESM-shim plugin's scanner, which then writes its shims into the middle of this file
      // and the production build fails to parse (electron-vite 5, `vite:esm-shim`).
      throw new Error('Missing the product whose servers would be read')
    }
    const importer = importers[provider as Provider]
    if (!importer) throw new Error(`TinyCorp cannot read ${provider}’s own MCP configuration yet`)
    return importer
  }
}

/** The tool a found server was read from, or a refusal that names what was asked for. */
function requireSource(source: unknown): McpSource {
  if (typeof source !== 'string' || !(MCP_SOURCES as readonly string[]).includes(source)) {
    throw new Error('Missing the tool whose server would be added')
  }
  return source as McpSource
}

/** The preset by its id. An id this build does not have is refused rather than half-applied. */
function presetFor(presetId: unknown): McpPreset {
  const preset = MCP_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) throw new Error(`There is no preset called ${String(presetId)}`)
  return preset
}

/**
 * What the boss filled in. Every value is text, and the secrets among them are passed straight
 * through to the keychain: nothing here returns one, and nothing stores one in the database.
 */
function requireValues(values: unknown): Record<string, string> {
  if (values === undefined) return {}
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw new Error('A preset is filled in with a set of names and values')
  }
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string') throw new Error(`The value for ${key} must be text`)
  }
  return values as Record<string, string>
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Missing the ${what}`)
  return value
}

function requireNames(chosen: unknown): string[] {
  const named = (name: unknown): name is string => typeof name === 'string' && name !== ''
  if (!Array.isArray(chosen) || !chosen.every(named)) {
    throw new Error('Servers to import are given as a list of names')
  }
  return chosen
}

function requireId(id: unknown): string {
  if (typeof id !== 'string' || id === '') throw new Error('Missing MCP server id')
  return id
}

/**
 * The fields the renderer may set. `secret` is the one that never comes back: it is passed
 * straight through to the keychain and is not part of anything this module returns.
 */
function serverInput(input: unknown, whole: boolean): McpServerInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected an object')
  const { name, transport, url, command, args, env, secretEnv, secret, headers } = input as Record<string, unknown>
  const fields = {
    name: optionalText(name, 'name'),
    transport: optionalText(transport, 'transport') as McpServerInput['transport'],
    url: optionalText(url, 'URL'),
    command: optionalText(command, 'command'),
    args: args === undefined ? undefined : requireList(args, 'arguments'),
    env: env === undefined ? undefined : requireRecord(env),
    secretEnv: optionalText(secretEnv, 'token variable'),
    secret: secret === undefined ? undefined : secret === null ? null : optionalText(secret, 'token'),
    // The plain headers of an `http` server (T245). `headerSecrets` is deliberately not here: a
    // header value the OS store holds arrives through a preset or an import, which are the two
    // paths whose values never touch the renderer, and this is the channel the renderer speaks on.
    headers: headers === undefined ? undefined : requireRecord(headers),
  }
  const given = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  if (whole && (given['name'] === undefined || given['transport'] === undefined)) {
    throw new Error('A server needs a name and a transport')
  }
  return given as unknown as McpServerInput
}

function optionalText(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`A server's ${what} must be text`)
  return value
}

function requireList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`A server's ${what} are a list of strings`)
  }
  return value as string[]
}

function requireRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a set of names and values')
  }
  return value as Record<string, string>
}
