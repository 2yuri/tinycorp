import { describe, expect, it } from 'vitest'
import { MCP_SOURCES, type McpSource } from '../../../shared/catalogue/mcp-sources'
import { createMcpSources, mcpSourcePath, readSource } from './mcp-sources'

/**
 * Reading the MCP servers the boss already has on this machine (T242).
 *
 * Two promises, and every case below is one of them.
 *
 * **No value is in a scan.** The reader parses six files, holds what it found, and hands the
 * renderer names — so these assertions go looking for the secrets in what crosses and expect not
 * to find them.
 *
 * **No test touches a home folder.** Every path is resolved from an environment this file writes,
 * and every file is a string this file writes: the Windows runner and the Linux one read exactly
 * what the Mac does, which is the only way the per-OS paths can be checked at all.
 */

const HOME = { HOME: '/home/boss', USERPROFILE: 'C:\\Users\\boss', APPDATA: 'C:\\Users\\boss\\AppData\\Roaming' }

/**
 * A resolved path, read POSIX. `node:path` joins with the separator of whichever runner is
 * running, so every assertion below would otherwise say something different on the Windows one —
 * and the point of these cases is the segments, which are the same everywhere.
 */
function posix(source: McpSource, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return mcpSourcePath(source, env, platform).replaceAll('\\', '/')
}

/** A reader over a set of files, keyed by the path each source resolves to on that platform. */
function sources(files: Partial<Record<McpSource, string>>, platform: NodeJS.Platform = 'linux') {
  const byPath = new Map(
    Object.entries(files).map(([source, text]) => [mcpSourcePath(source as McpSource, HOME, platform), text]),
  )
  return createMcpSources({ env: HOME, platform, readFile: (path) => byPath.get(path) ?? null })
}

const CLAUDE_CODE = JSON.stringify({
  numStartups: 12,
  mcpServers: {
    pencil: { type: 'stdio', command: 'pen-mcp', args: ['--app', 'desktop'] },
    github: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
    },
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_supersecret' } },
  },
  projects: { '/work/acme': { mcpServers: { acme: { command: 'acme-mcp' } } } },
})

const CODEX = `
model = "gpt-5"

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"
bearer_token_env_var = "CONTEXT7_KEY"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]

[mcp_servers.warehouse]
command = "warehouse-mcp"
env = { DATABASE_URL = "postgres://boss:hunter2@db/acme" }
`

const OPENCODE = JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  mcp: {
    grafana: { type: 'remote', url: 'https://grafana.example.com/mcp', headers: { Authorization: 'Bearer graf_key' } },
    notes: { type: 'local', command: ['notes-mcp', '--vault', 'work'], environment: { NOTES_KEY: 'nk_supersecret' } },
  },
})

const CURSOR = JSON.stringify({ mcpServers: { supabase: { url: 'https://mcp.supabase.com/mcp' } } })

/** VS Code ships this file commented, and `servers` is its own key for the same shape. */
const VSCODE = `{
  // added by the Stripe extension
  "servers": {
    "stripe": { "type": "http", "url": "https://mcp.stripe.com" },
  }
}`

const CLAUDE_DESKTOP = JSON.stringify({
  mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/work'] } },
})

describe('Where each tool keeps the boss’s own MCP servers', () => {
  it('resolves every source on macOS, where two of them live under Application Support', () => {
    const at = (source: McpSource) => posix(source, HOME, 'darwin')

    expect(at('claude-code')).toBe('/home/boss/.claude.json')
    expect(at('codex')).toBe('/home/boss/.codex/config.toml')
    expect(at('opencode')).toBe('/home/boss/.config/opencode/opencode.json')
    expect(at('claude-desktop')).toBe('/home/boss/Library/Application Support/Claude/claude_desktop_config.json')
    expect(at('cursor')).toBe('/home/boss/.cursor/mcp.json')
    expect(at('vscode')).toBe('/home/boss/Library/Application Support/Code/User/mcp.json')
  })

  it('resolves every source on Linux, where Application Support is the XDG config home', () => {
    const at = (source: McpSource) => posix(source, HOME, 'linux')

    expect(at('claude-desktop')).toBe('/home/boss/.config/Claude/claude_desktop_config.json')
    expect(at('vscode')).toBe('/home/boss/.config/Code/User/mcp.json')
    expect(at('opencode')).toBe('/home/boss/.config/opencode/opencode.json')
  })

  it('follows XDG_CONFIG_HOME on Linux, because a boss who moved it moved all three', () => {
    const env = { ...HOME, XDG_CONFIG_HOME: '/home/boss/elsewhere' }

    expect(posix('vscode', env, 'linux')).toBe('/home/boss/elsewhere/Code/User/mcp.json')
    expect(posix('opencode', env, 'linux')).toBe('/home/boss/elsewhere/opencode/opencode.json')
    expect(posix('claude-desktop', env, 'linux')).toBe('/home/boss/elsewhere/Claude/claude_desktop_config.json')
  })

  it('resolves every source on Windows, where two of them live under %APPDATA%', () => {
    const at = (source: McpSource) => posix(source, HOME, 'win32')

    expect(at('claude-desktop')).toBe('C:/Users/boss/AppData/Roaming/Claude/claude_desktop_config.json')
    expect(at('vscode')).toBe('C:/Users/boss/AppData/Roaming/Code/User/mcp.json')
    expect(at('cursor')).toBe('/home/boss/.cursor/mcp.json')
  })

  it('falls back to the profile when Windows has no %APPDATA%, rather than resolving to nothing', () => {
    const path = posix('vscode', { USERPROFILE: 'C:\\Users\\boss' }, 'win32')

    expect(path).toBe('C:/Users/boss/AppData/Roaming/Code/User/mcp.json')
  })

  it('follows the variables each of the two Providers uses to move its own folder', () => {
    expect(posix('claude-code', { ...HOME, CLAUDE_CONFIG_DIR: '/elsewhere' }, 'linux')).toBe('/elsewhere/.claude.json')
    expect(posix('codex', { ...HOME, CODEX_HOME: '/elsewhere/codex' }, 'linux')).toBe('/elsewhere/codex/config.toml')
  })

  it('answers a path for every source in the catalogue, so a new one cannot be half-added', () => {
    for (const source of MCP_SOURCES) {
      expect(mcpSourcePath(source, HOME, 'darwin')).not.toBe('')
    }
  })
})

describe('Reading one source’s file', () => {
  it('reads the user scope and the projects of a Claude-style config, user scope first', () => {
    const found = readSource('claude-code', CLAUDE_CODE)

    expect(found.map((server) => server.name)).toEqual(['pencil', 'github', 'linear', 'acme'])
  })

  it('does not list a project server twice when the user scope already used its name', () => {
    const config = JSON.stringify({
      mcpServers: { github: { command: 'user-github' } },
      projects: { '/a': { mcpServers: { github: { command: 'project-github' } } } },
    })

    const found = readSource('claude-code', config)

    expect(found).toHaveLength(1)
    expect(found[0]?.command).toBe('user-github')
  })

  it('reads Codex’s TOML tables, including one with an inline environment table', () => {
    const found = readSource('codex', CODEX)

    expect(found.map((server) => `${server.name}:${server.kind}`)).toEqual([
      'context7:http',
      'playwright:stdio',
      'warehouse:stdio',
    ])
    expect(found[1]?.args).toEqual(['-y', '@playwright/mcp@latest'])
    expect(Object.keys(found[2]?.env ?? {})).toEqual(['DATABASE_URL'])
  })

  it('reads OpenCode’s own words: remote is http and local is a command with its arguments', () => {
    const found = readSource('opencode', OPENCODE)

    expect(found[0]).toMatchObject({ name: 'grafana', kind: 'http', url: 'https://grafana.example.com/mcp' })
    expect(found[1]).toMatchObject({ name: 'notes', kind: 'stdio', command: 'notes-mcp', args: ['--vault', 'work'] })
  })

  it('reads VS Code’s `servers` key through the comments and the trailing comma it ships with', () => {
    const found = readSource('vscode', VSCODE)

    expect(found).toMatchObject([{ name: 'stripe', kind: 'http', url: 'https://mcp.stripe.com' }])
  })

  it('reads Cursor’s and Claude Desktop’s `mcpServers`, and infers the transport from the fields', () => {
    expect(readSource('cursor', CURSOR)).toMatchObject([{ name: 'supabase', kind: 'http' }])
    expect(readSource('claude-desktop', CLAUDE_DESKTOP)).toMatchObject([{ name: 'filesystem', kind: 'stdio' }])
  })

  it('treats a file it cannot parse as a file with nothing in it, never as a crash', () => {
    expect(readSource('claude-code', '{ this is not json')).toEqual([])
    expect(readSource('codex', 'model = = "gpt-5"')).toEqual([])
    expect(readSource('claude-code', null)).toEqual([])
  })

  it('does not mistake a URL inside a string for the start of a comment', () => {
    const found = readSource('cursor', '{"mcpServers": {"a": {"url": "https://example.com/mcp"}}}')

    expect(found[0]?.url).toBe('https://example.com/mcp')
  })
})

describe('Scanning this machine', () => {
  it('groups what it found by the tool it came from, and leaves out the tools with nothing', () => {
    const groups = sources({ 'claude-code': CLAUDE_CODE, cursor: CURSOR }).scan([])

    expect(groups.map((group) => group.source)).toEqual(['claude-code', 'cursor'])
    expect(groups[0]?.path.replaceAll('\\', '/')).toBe('/home/boss/.claude.json')
    expect(groups[0]?.servers.map((server) => server.name)).toEqual(['pencil', 'github', 'linear', 'acme'])
  })

  it('carries no value at all: only the names of the variables and whether a token came with it', () => {
    const groups = sources({ 'claude-code': CLAUDE_CODE, codex: CODEX, opencode: OPENCODE }).scan([])

    const crossed = JSON.stringify(groups)
    for (const secret of ['ghp_supersecret', 'lin_supersecret', 'nk_supersecret', 'graf_key', 'hunter2']) {
      expect(crossed).not.toContain(secret)
    }
    const github = groups[0]?.servers.find((server) => server.name === 'github')
    expect(github).toMatchObject({ secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_HOST'], hasToken: false })
    expect(groups[0]?.servers.find((server) => server.name === 'linear')).toMatchObject({ hasToken: true })
  })

  it('marks a server this Company already has rather than offering it again', () => {
    const groups = sources({ cursor: CURSOR }).scan(['SUPABASE'])

    expect(groups[0]?.servers[0]).toMatchObject({ name: 'supabase', added: true, problem: null })
  })

  it('lists a transport TinyCorp cannot carry and refuses it, rather than guessing at it', () => {
    const groups = sources({
      cursor: JSON.stringify({ mcpServers: { old: { type: 'sse', url: 'https://x/sse' } } }),
    }).scan([])

    expect(groups[0]?.servers[0]).toMatchObject({ name: 'old', problem: 'sse — TinyCorp carries http and stdio' })
  })

  /** A header-authenticated server is added with its headers now (T245), names shown and values not. */
  it('offers an http server whose authentication is named headers, and shows only the names', () => {
    const config = JSON.stringify({
      mcpServers: { odd: { type: 'http', url: 'https://x/mcp', headers: { 'X-Api-Key': 'k-supersecret' } } },
    })

    const found = sources({ cursor: config })
    const groups = found.scan([])

    expect(groups[0]?.servers[0]).toMatchObject({ problem: null, secretNames: ['X-Api-Key'] })
    expect(JSON.stringify(groups)).not.toContain('k-supersecret')
    expect(found.take('cursor', 'odd')).toEqual({
      name: 'odd',
      transport: 'http',
      url: 'https://x/mcp',
      headerSecrets: { 'X-Api-Key': 'k-supersecret' },
    })
  })

  it('refuses a header name no adapter could write, rather than offering a server that half works', () => {
    const config = JSON.stringify({
      mcpServers: { odd: { type: 'http', url: 'https://x/mcp', headers: { 'X.Api:Key': 'k' } } },
    })

    const groups = sources({ cursor: config }).scan([])

    expect(groups[0]?.servers[0]?.problem).toBe('X.Api:Key — not a header name TinyCorp can carry')
  })

  it('refuses a name the catalogue could not hold, in the catalogue’s own words', () => {
    const groups = sources({ cursor: JSON.stringify({ mcpServers: { 'My Server': { command: 'x' } } }) }).scan([])

    expect(groups[0]?.servers[0]?.problem).toMatch(/Lower case letters/)
  })
})

describe('Taking one found server into the catalogue', () => {
  it('hands over the values the scan held, as write-only secrets', () => {
    const reader = sources({ 'claude-code': CLAUDE_CODE })
    reader.scan([])

    expect(reader.take('claude-code', 'github')).toEqual({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
      secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
    })
  })

  it('hands an http server its bearer token with the `Bearer` taken off', () => {
    const reader = sources({ 'claude-code': CLAUDE_CODE })
    reader.scan([])

    expect(reader.take('claude-code', 'linear')).toEqual({
      name: 'linear',
      transport: 'http',
      url: 'https://mcp.linear.app/mcp',
      secret: 'lin_supersecret',
    })
  })

  it('offers nothing for a name the last scan did not read, or for one under another tool', () => {
    const reader = sources({ 'claude-code': CLAUDE_CODE, cursor: CURSOR })
    reader.scan([])

    expect(reader.take('cursor', 'github')).toBeNull()
    expect(reader.take('claude-code', 'made-up')).toBeNull()
  })

  it('offers nothing for a server that was refused, or for one the Company already has', () => {
    const reader = sources({ cursor: CURSOR, codex: 'x = [' })
    reader.scan(['supabase'])

    expect(reader.take('cursor', 'supabase')).toBeNull()
  })

  it('forgets the last scan’s values when it scans again, so an old name cannot be taken', () => {
    const reader = sources({ 'claude-code': CLAUDE_CODE })
    reader.scan([])
    reader.scan(['github', 'linear', 'pencil', 'acme'])

    expect(reader.take('claude-code', 'github')).toBeNull()
  })
})
