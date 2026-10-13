import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { memorySecrets, type SecretStore } from '../../platform/secrets'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

/**
 * The Company's MCP catalogue, the grant that follows the role, and what a Session is actually
 * handed (T136).
 *
 * Nothing here touches the machine's keychain: the store is injected, and what it holds is
 * asserted through what reaches a spawned process, never by reading a secret back out of the app.
 */

const engines: CompanyEngine[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/**
 * A Company with one Provider. `rows` reads the catalogue table itself, because "the value is not
 * in the database" is a claim about the database and not about what a getter chooses to return.
 */
function company(secrets: SecretStore = memorySecrets()): {
  engine: CompanyEngine
  provider: FakeProvider
  rows(): unknown[]
} {
  const provider = fakeProvider()
  const open = inMemoryDatabases()
  let db: DatabaseSync | null = null
  const engine = createCompanyEngine({
    openDatabase: (folder, mode) => {
      const opened = open(folder, mode)
      if (opened) db = opened
      return opened
    },
    recents: inMemoryRecents(),
    providers: { claude: provider },
    mcpUrl: () => 'http://127.0.0.1:7377/mcp',
    secrets,
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider, rows: () => db?.prepare('SELECT * FROM mcp_server').all() ?? [] }
}

function linear(engine: CompanyEngine, over: Partial<Parameters<CompanyEngine['mcp']['create']>[0]> = {}) {
  return engine.mcp.create({ name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', ...over })
}

/** A `stdio` server as an import hands it over: every environment value a secret, none of them env. */
function imported(engine: CompanyEngine) {
  return engine.mcp.create({
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: {},
    secrets: { GITHUB_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
  })
}

/** A header-authenticated `http` server as a preset hands it over (T245): SigNoz, both halves. */
function signoz(engine: CompanyEngine) {
  return engine.mcp.create({
    name: 'signoz',
    transport: 'http',
    url: 'https://mcp.us.signoz.cloud/mcp',
    headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
    headerSecrets: { 'SIGNOZ-API-KEY': 'signoz_supersecret' },
  })
}

describe('The Company’s MCP catalogue', () => {
  it('holds a server the boss typed in, and says how it is reached', () => {
    const { engine } = company()

    const server = linear(engine)

    expect(engine.mcp.list()).toEqual([
      expect.objectContaining({
        id: server.id,
        name: 'linear',
        transport: 'http',
        url: 'https://mcp.linear.app/mcp',
        hasSecret: false,
        employees: 0,
      }),
    ])
  })

  it('keeps a stdio server’s command and arguments, and empties the other transport’s fields', () => {
    const { engine } = company()

    const server = engine.mcp.create({
      name: 'playwright',
      transport: 'stdio',
      url: 'https://ignored.example.com',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      env: { PLAYWRIGHT_BROWSER: 'chromium' },
    })

    expect(server).toMatchObject({ command: 'npx', args: ['@playwright/mcp@latest'], url: '' })
  })

  it('refuses a name another server has, the Company’s own server name, and a name with spaces', () => {
    const { engine } = company()
    linear(engine)

    expect(() => linear(engine)).toThrow(/already has a server named linear/i)
    expect(() => linear(engine, { name: 'company' })).toThrow(/Company's own server/i)
    expect(() => linear(engine, { name: 'my server' })).toThrow(/lower case/i)
  })

  it('refuses an http server with no URL and a stdio server with no command', () => {
    const { engine } = company()

    expect(() => engine.mcp.create({ name: 'a', transport: 'http', url: '' })).toThrow(/needs a URL/i)
    expect(() => engine.mcp.create({ name: 'b', transport: 'stdio', command: '' })).toThrow(/needs a command/i)
  })

  it('never returns a secret, only whether there is one', () => {
    const { engine } = company()

    const server = linear(engine, { secret: 'lin_api_supersecret' })

    expect(JSON.stringify(engine.mcp.list())).not.toContain('lin_api_supersecret')
    expect(engine.mcp.list()[0]).toMatchObject({ id: server.id, hasSecret: true })
  })

  it('stores the secret under the Company and the server, and forgets it on null', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id

    const server = linear(engine, { secret: 'lin_api_supersecret' })
    expect(secrets.read(companyId, server.id)).toBe('lin_api_supersecret')

    // An edit that does not mention the secret leaves the keychain alone.
    engine.mcp.update(server.id, { url: 'https://mcp.linear.app/sse' })
    expect(secrets.read(companyId, server.id)).toBe('lin_api_supersecret')

    engine.mcp.update(server.id, { secret: null })
    expect(secrets.read(companyId, server.id)).toBeNull()
    expect(engine.mcp.list()[0]!.hasSecret).toBe(false)
  })
})

describe('An MCP grant', () => {
  it('follows the role: everyone hired into it holds the role’s servers', () => {
    const { engine } = company()
    const server = linear(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { mcpServers: [server.id] })

    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    expect(ada.mcpServers).toEqual([server.id])
    expect(ada.overrides).not.toContain('mcpServers')
  })

  it('reaches an Employee hired before the role had it, because the role edit propagates', () => {
    const { engine } = company()
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })
    const server = linear(engine)

    engine.roles.update(role.id, { mcpServers: [server.id] })

    expect(engine.employees.list().find((e) => e.id === ada.id)!.mcpServers).toEqual([server.id])
  })

  it('can be overridden on one Employee, and a later role edit leaves that Employee alone', () => {
    const { engine } = company()
    const linearServer = linear(engine)
    const sentry = engine.mcp.create({ name: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp' })
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { mcpServers: [linearServer.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })
    const grace = engine.employees.create({ name: 'Grace', roleId: role.id })

    const overridden = engine.employees.update(ada.id, { mcpServers: [sentry.id] })
    engine.roles.update(role.id, { mcpServers: [linearServer.id, sentry.id] })

    expect(overridden.overrides).toContain('mcpServers')
    expect(engine.employees.list().find((e) => e.id === ada.id)!.mcpServers).toEqual([sentry.id])
    expect(engine.employees.list().find((e) => e.id === grace.id)!.mcpServers).toEqual([linearServer.id, sentry.id])
  })

  it('goes back to following the role when the boss resets it', () => {
    const { engine } = company()
    const server = linear(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { mcpServers: [server.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [] })

    const following = engine.employees.update(ada.id, { followRole: ['mcpServers'] })

    expect(following.mcpServers).toEqual([server.id])
    expect(following.overrides).not.toContain('mcpServers')
  })

  it('refuses a server this Company does not have', () => {
    const { engine } = company()
    const role = engine.roles.ensure(['backend'])[0]!

    expect(() => engine.roles.update(role.id, { mcpServers: ['not-a-server'] })).toThrow(/Unknown MCP server/i)
  })
})

describe('Removing an MCP server', () => {
  it('says how many Employees and roles hold it before anything is done', () => {
    const { engine } = company()
    const server = linear(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { mcpServers: [server.id] })
    engine.employees.create({ name: 'Ada', roleId: role.id })
    engine.employees.create({ name: 'Grace', roleId: role.id })

    expect(engine.mcp.impact(server.id)).toEqual({ name: 'linear', employees: 2, roles: 1 })
    expect(engine.mcp.list()).toHaveLength(1)
  })

  it('takes the grant off every Employee and role that held it, and leaves the others', () => {
    const { engine } = company()
    const linearServer = linear(engine)
    const sentry = engine.mcp.create({ name: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp' })
    const role = engine.roles.ensure(['backend'])[0]!
    engine.roles.update(role.id, { mcpServers: [linearServer.id, sentry.id] })
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    engine.mcp.remove(linearServer.id)

    expect(engine.employees.list().find((e) => e.id === ada.id)!.mcpServers).toEqual([sentry.id])
    expect(engine.roles.list().find((r) => r.id === role.id)!.mcpServers).toEqual([sentry.id])
    expect(engine.mcp.list().map((s) => s.name)).toEqual(['sentry'])
  })

  it('forgets its secret with it', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = linear(engine, { secret: 'lin_api_supersecret' })

    engine.mcp.remove(server.id)

    expect(secrets.read(companyId, server.id)).toBeNull()
  })

  /**
   * An imported server carries a value per environment variable it named (T235). Removing it has
   * to take every one of them, or a Company that removed a server would leave its tokens in the
   * machine's store under a key nothing reads any more.
   */
  it('forgets every one of an imported server’s named values with it', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = imported(engine)

    engine.mcp.remove(server.id)

    expect(secrets.read(companyId, `${server.id}:GITHUB_TOKEN`)).toBeNull()
    expect(secrets.read(companyId, `${server.id}:GITHUB_HOST`)).toBeNull()
  })
})

/**
 * A server the boss imported from their own Claude Code (T235): nothing it runs on is in the
 * database, because TinyCorp cannot tell which of a server's environment values is a secret and
 * treats all of them as one.
 */
describe('An imported MCP server', () => {
  it('keeps the names of its values in the catalogue and every value in the store', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id

    const server = imported(engine)

    expect(server).toMatchObject({ secretNames: ['GITHUB_TOKEN', 'GITHUB_HOST'], env: {}, hasSecret: false })
    expect(secrets.read(companyId, `${server.id}:GITHUB_TOKEN`)).toBe('ghp_supersecret')
    expect(secrets.read(companyId, `${server.id}:GITHUB_HOST`)).toBe('github.example.com')
  })

  it('hands a Session its values, under the variables they were named by', () => {
    const { engine, provider } = company()
    const server = imported(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [server.id] })

    engine.sessions.start(ada.id)

    expect(provider.spawns[0]!.granted[0]).toMatchObject({
      name: 'github',
      env: {},
      secrets: { GITHUB_TOKEN: 'ghp_supersecret', GITHUB_HOST: 'github.example.com' },
    })
  })

  it('forgets a value whose name a later edit dropped', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = imported(engine)

    engine.mcp.update(server.id, { secrets: { GITHUB_TOKEN: 'ghp_newer' } })

    expect(engine.mcp.list()[0]!.secretNames).toEqual(['GITHUB_TOKEN'])
    expect(secrets.read(companyId, `${server.id}:GITHUB_TOKEN`)).toBe('ghp_newer')
    expect(secrets.read(companyId, `${server.id}:GITHUB_HOST`)).toBeNull()
  })

  it('keeps its values through an edit that does not mention them', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = imported(engine)

    engine.mcp.update(server.id, { command: 'npx' })

    expect(engine.mcp.list()[0]!.secretNames).toEqual(['GITHUB_TOKEN', 'GITHUB_HOST'])
    expect(secrets.read(companyId, `${server.id}:GITHUB_TOKEN`)).toBe('ghp_supersecret')
  })
})

/**
 * A server that authenticates with named headers rather than a bearer token (T245): Datadog wants
 * two keys, SigNoz a key and the URL of the boss's own instance. The keys are kept exactly where an
 * imported server's environment values are — in the OS store, under the server's own id — and the
 * database holds their names and nothing else.
 */
describe('A header-authenticated MCP server', () => {
  it('keeps every header value out of the database and in the store, and only the names in the row', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id

    const server = signoz(engine)

    expect(server).toMatchObject({
      headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
      headerSecretNames: ['SIGNOZ-API-KEY'],
      hasSecret: false,
    })
    expect(secrets.read(companyId, `${server.id}:SIGNOZ-API-KEY`)).toBe('signoz_supersecret')
    // The row the renderer is handed is the row the database holds, and the key is in neither.
    expect(JSON.stringify(engine.mcp.list())).not.toContain('signoz_supersecret')
  })

  it('never writes a header value into the Company database, only the header’s name', () => {
    const { engine, rows } = company()

    signoz(engine)

    const stored = JSON.stringify(rows())
    expect(stored).not.toContain('signoz_supersecret')
    expect(stored).toContain('SIGNOZ-API-KEY')
  })

  it('hands a Session the plain headers and the secret ones apart, each with its value', () => {
    const { engine, provider } = company()
    const server = signoz(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [server.id] })

    engine.sessions.start(ada.id)

    expect(provider.spawns[0]!.granted[0]).toMatchObject({
      name: 'signoz',
      url: 'https://mcp.us.signoz.cloud/mcp',
      secret: null,
      headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
      headerSecrets: { 'SIGNOZ-API-KEY': 'signoz_supersecret' },
    })
  })

  it('keeps its headers through an edit that does not mention them', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = signoz(engine)

    engine.mcp.update(server.id, { url: 'https://mcp.eu.signoz.cloud/mcp' })

    expect(engine.mcp.list()[0]).toMatchObject({
      url: 'https://mcp.eu.signoz.cloud/mcp',
      headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
      headerSecretNames: ['SIGNOZ-API-KEY'],
    })
    expect(secrets.read(companyId, `${server.id}:SIGNOZ-API-KEY`)).toBe('signoz_supersecret')
  })

  it('forgets every header value when the server is removed', () => {
    const secrets = memorySecrets()
    const { engine } = company(secrets)
    const companyId = engine.currentCompany()!.id
    const server = signoz(engine)

    engine.mcp.remove(server.id)

    expect(secrets.read(companyId, `${server.id}:SIGNOZ-API-KEY`)).toBeNull()
  })

  it('refuses a bearer header and a header name an adapter could not write', () => {
    const { engine } = company()

    expect(() =>
      engine.mcp.create({ name: 'odd', transport: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'x' } }),
    ).toThrow(/bearer token/)
    expect(() =>
      engine.mcp.create({
        name: 'odder',
        transport: 'http',
        url: 'https://x.test/mcp',
        headerSecrets: { 'X.Odd:Header': 'x' },
      }),
    ).toThrow(/header name/)
  })

  it('has no headers on a stdio server, where nothing would ever send them', () => {
    const { engine } = company()

    const server = engine.mcp.create({
      name: 'local',
      transport: 'stdio',
      command: 'npx',
      headers: { 'X-SigNoz-URL': 'https://acme.us.signoz.cloud' },
    })

    expect(server.headers).toEqual({})
  })
})

describe('A Session', () => {
  it('is handed the servers its Employee holds, with their secrets, and no others', () => {
    const { engine, provider } = company()
    const granted = linear(engine, { secret: 'lin_api_supersecret' })
    engine.mcp.create({ name: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp' })
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [granted.id] })
    const grace = engine.employees.create({ name: 'Grace', roleId: role.id })

    engine.sessions.start(ada.id)
    engine.sessions.start(grace.id)

    const [adaSpawn, graceSpawn] = provider.spawns
    expect(adaSpawn!.granted).toEqual([
      expect.objectContaining({ name: 'linear', url: 'https://mcp.linear.app/mcp', secret: 'lin_api_supersecret' }),
    ])
    expect(graceSpawn!.granted).toEqual([])
  })

  it('is handed a granted server with no secret as one with no secret', () => {
    const { engine, provider } = company()
    const granted = linear(engine)
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [granted.id] })

    engine.sessions.start(ada.id)

    expect(provider.spawns[0]!.granted[0]).toMatchObject({ name: 'linear', secret: null })
  })

  it('is told in its instructions what it was given, and nothing about what it was not', () => {
    const { engine, provider } = company()
    const granted = linear(engine)
    engine.mcp.create({ name: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp' })
    const role = engine.roles.ensure(['backend'])[0]!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id, mcpServers: [granted.id] })

    engine.sessions.start(ada.id)

    const instructions = provider.spawns[0]!.instructions!.text
    expect(instructions).toContain('## Your MCP servers')
    expect(instructions).toContain('- `linear` (http): https://mcp.linear.app/mcp')
    expect(instructions).not.toContain('sentry')
  })

  it('says nothing about MCP servers when it holds none', () => {
    const { engine, provider } = company()
    linear(engine)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    expect(provider.spawns[0]!.instructions!.text).not.toContain('## Your MCP servers')
  })
})
