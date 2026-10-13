import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_IMPORT_PROVIDERS } from '../../../shared/catalogue/mcp-import'
import { claudeConfigPath, createMcpImporter, createMcpImporters } from './mcp-import'

/**
 * Reading the boss's own Claude Code config (T235).
 *
 * The test every other one here is a variation of: **no value is in the preview**. The importer
 * parses the file, holds what it found, and hands the renderer names — so these assertions look
 * for the secrets in what crosses, and expect not to find them.
 */

const PEN = {
  type: 'stdio',
  command: '/Applications/Pen.app/Contents/Resources/mcp-server',
  args: ['--app', 'desktop'],
}
const GITHUB = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
}
const LINEAR = { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_supersecret' } }

function importer(config: unknown, env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/home/boss' }) {
  return createMcpImporter({ env, readFile: () => (config === null ? null : JSON.stringify(config)) })
}

function claude(mcpServers: Record<string, unknown>) {
  return { numStartups: 12, mcpServers, projects: { '/work/acme': { mcpServers: { local: { command: 'x' } } } } }
}

describe('Importing MCP servers from Claude Code', () => {
  it('lists the user-level servers with their transport and where they are reached', () => {
    const scan = importer(claude({ pencil: PEN, linear: LINEAR })).scan([])

    expect(MCP_IMPORT_PROVIDERS).toContain(scan.source)
    expect(scan.servers).toEqual([
      expect.objectContaining({
        name: 'pencil',
        transport: 'stdio',
        target: '/Applications/Pen.app/Contents/Resources/mcp-server --app desktop',
        chosen: true,
        problem: null,
      }),
      expect.objectContaining({
        name: 'linear',
        transport: 'http',
        target: 'https://mcp.linear.app/mcp',
        hasToken: true,
        chosen: true,
        problem: null,
      }),
    ])
  })

  /**
   * A project's own `mcpServers` is that project's, not the boss's. Importing one would put a
   * repo's tools in a Company that may have nothing to do with it, and the ticket asks for the
   * user-level list.
   */
  /**
   * The card offers a button per Provider the catalogue says can be imported from, so a Provider
   * on that list with no reader behind it would draw a button that only ever fails.
   */
  it('has a reader for every Provider the catalogue offers an import from', () => {
    const readers = createMcpImporters()

    expect(Object.keys(readers).sort()).toEqual([...MCP_IMPORT_PROVIDERS].sort())
  })

  it('reads only the user-level list, never a project’s', () => {
    const scan = importer(claude({ pencil: PEN })).scan([])

    expect(scan.servers.map((server) => server.name)).toEqual(['pencil'])
  })

  it('shows the names of a server’s environment variables and not one of their values', () => {
    const scan = importer(claude({ github: GITHUB, linear: LINEAR })).scan([])

    const github = scan.servers.find((server) => server.name === 'github')
    expect(github?.secretNames).toEqual(['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_HOST'])
    expect(JSON.stringify(scan)).not.toContain('ghp_supersecret')
    expect(JSON.stringify(scan)).not.toContain('lin_supersecret')
  })

  /**
   * Every environment value is treated as a secret, because TinyCorp cannot tell which of them is
   * one: what the catalogue is handed carries no `env` at all, and the values ride in `secrets`,
   * which the catalogue puts in the OS store.
   */
  it('hands the catalogue every environment value as a secret, and none as plain env', () => {
    const importing = importer(claude({ github: GITHUB }))
    importing.scan([])

    expect(importing.take('github')).toEqual({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
      secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
    })
  })

  it('carries an http server’s bearer token as the token the catalogue already keeps', () => {
    const importing = importer(claude({ linear: LINEAR }))
    importing.scan([])

    expect(importing.take('linear')).toEqual({
      name: 'linear',
      transport: 'http',
      url: 'https://mcp.linear.app/mcp',
      secret: 'lin_supersecret',
    })
  })

  it('offers nothing for a server the last scan did not list', () => {
    const importing = importer(claude({ pencil: PEN }))
    importing.scan([])

    expect(importing.take('github')).toBeNull()
  })

  it('refuses a name this Company already has, and says so on the row', () => {
    const scan = importer(claude({ linear: LINEAR })).scan(['Linear'])

    expect(scan.servers[0]).toMatchObject({ name: 'linear', chosen: false, problem: 'already in the catalogue' })
  })

  /**
   * An `http` server that authenticates with named headers comes across with them (T245): the
   * catalogue keeps the header's name and the OS store keeps its value, the way an imported `stdio`
   * server's environment travels. The preview says the name and not one character of the value —
   * this is the boss's own config and TinyCorp cannot tell which half of it is private.
   */
  it('imports an http server whose authentication is named headers, values to the store', () => {
    const importing = importer(
      claude({
        acme: { type: 'http', url: 'https://acme.test/mcp', headers: { 'X-Api-Key': 'k-supersecret' } },
      }),
    )

    const scan = importing.scan([])

    expect(scan.servers[0]).toMatchObject({ chosen: true, problem: null, secretNames: ['X-Api-Key'] })
    expect(JSON.stringify(scan)).not.toContain('k-supersecret')
    expect(importing.take('acme')).toEqual({
      name: 'acme',
      transport: 'http',
      url: 'https://acme.test/mcp',
      headerSecrets: { 'X-Api-Key': 'k-supersecret' },
    })
  })

  it('refuses a header name no adapter could write, rather than importing a server that half works', () => {
    const scan = importer(
      claude({ acme: { type: 'http', url: 'https://acme.test/mcp', headers: { 'X.Api:Key': 'k' } } }),
    ).scan([])

    expect(scan.servers[0]).toMatchObject({
      chosen: false,
      problem: 'X.Api:Key — not a header name TinyCorp can carry',
    })
    expect(JSON.stringify(scan)).not.toContain('"k"')
  })

  it('refuses a transport TinyCorp has no way to reach, rather than guessing at it', () => {
    const scan = importer(claude({ old: { type: 'sse', url: 'https://acme.test/sse' } })).scan([])

    expect(scan.servers[0]).toMatchObject({ chosen: false, problem: 'sse — TinyCorp carries http and stdio' })
  })

  it('refuses a name the catalogue could not store, in the catalogue’s own words', () => {
    const scan = importer(claude({ 'Pen Server': PEN, company: PEN })).scan([])

    expect(scan.servers[0]?.problem).toMatch(/Lower case letters/)
    expect(scan.servers[1]?.problem).toMatch(/is the Company/)
  })

  it('refuses a stdio server with no command and an http server with no url', () => {
    const scan = importer(claude({ broken: { type: 'stdio' }, 'also-broken': { type: 'http' } })).scan([])

    expect(scan.servers.map((server) => server.problem)).toEqual(['no command', 'no url'])
  })

  /** A config this app cannot read is a config with nothing in it: Claude Code owns that file. */
  it('finds nothing in a missing file, in one that is not JSON, and in one with no servers', () => {
    for (const config of [null, 'not json at all', {}, { mcpServers: [] }]) {
      const readFile = () => (config === null ? null : typeof config === 'string' ? config : JSON.stringify(config))
      const scan = createMcpImporter({ env: {}, readFile }).scan([])
      expect(scan.servers).toEqual([])
      expect(scan.path).toContain('.claude.json')
    }
  })

  /**
   * The file is `~/.claude.json` on macOS, Windows and Linux alike, and `CLAUDE_CONFIG_DIR` moves
   * it — the same variable Claude Code itself reads. Nothing here joins a path by hand.
   */
  it('reads the config where Claude Code keeps it, and follows CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigPath({ CLAUDE_CONFIG_DIR: '/home/boss/.config/claude' })).toBe(
      join('/home/boss/.config/claude', '.claude.json'),
    )
    expect(claudeConfigPath({})).toBe(join(homedir(), '.claude.json'))
  })
})
