import { afterEach, describe, expect, it } from 'vitest'
import { mcpChannels, staffChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { memorySecrets, type SecretStore } from '../../platform/secrets'
import { registerStaffIpc } from '../staff'
import { createMcpImporter } from './mcp-import'
import { registerMcpIpc } from './mcp-ipc'
import { createMcpSources } from './mcp-sources'

/**
 * The MCP catalogue over IPC (T136): what the renderer may set, what it gets back, and the one
 * thing it must never get back — the token.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** The boss's own Claude Code config, as the importer would find it. */
const CLAUDE_CONFIG = {
  mcpServers: {
    pencil: { type: 'stdio', command: 'pen-mcp', args: ['--app', 'desktop'] },
    github: { type: 'stdio', command: 'npx', env: { GITHUB_TOKEN: 'ghp_supersecret' } },
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_supersecret' } },
  },
}

/** What the six tools on this machine hold, as the reader would find it. Two of them do. */
const MACHINE: Record<string, string> = {
  '/boss/.cursor/mcp.json': JSON.stringify({
    mcpServers: {
      supabase: { url: 'https://mcp.supabase.com/mcp', headers: { Authorization: 'Bearer sbp_supersecret' } },
    },
  }),
  '/boss/.config/Code/User/mcp.json': JSON.stringify({
    servers: {
      datadog: { type: 'http', url: 'https://mcp.datadoghq.com/v1/mcp', headers: { DD_API_KEY: 'dd_supersecret' } },
    },
  }),
  '/boss/.codex/config.toml': [
    '[mcp_servers.warehouse]',
    'command = "warehouse-mcp"',
    'env = { DATABASE_URL = "postgres://boss:hunter2@db/acme" }',
  ].join('\n'),
}

function setup(secrets: SecretStore = memorySecrets()) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    secrets,
  })
  engines.push(engine)
  let broadcasts = 0
  registerMcpIpc({
    ipc,
    engine,
    broadcastChanged: () => broadcasts++,
    importers: { claude: createMcpImporter({ env: {}, readFile: () => JSON.stringify(CLAUDE_CONFIG) }) },
    sources: createMcpSources({
      env: { HOME: '/boss' },
      platform: 'linux',
      readFile: (path) => MACHINE[path.replaceAll('\\', '/')] ?? null,
    }),
  })
  registerStaffIpc({ ipc, engine, broadcastChanged: () => {} })
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

const LINEAR = { name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp' }

describe('MCP servers IPC', () => {
  it('adds a server and lists it, with whether it has a secret and who holds it', async () => {
    const { invoke } = setup()

    const added = (await invoke(mcpChannels.add, LINEAR)) as { ok: true; value: { id: string } }
    expect(added).toMatchObject({ ok: true, value: { name: 'linear', hasSecret: false, employees: 0 } })
    expect(await invoke(mcpChannels.list)).toMatchObject({ ok: true, value: [{ id: added.value.id }] })
  })

  it('never hands the token back, on add, on update or on list', async () => {
    const { invoke } = setup()

    const added = await invoke(mcpChannels.add, { ...LINEAR, secret: 'lin_api_supersecret' })
    const updated = await invoke(mcpChannels.update, (added as { value: { id: string } }).value.id, {
      secret: 'another_one',
    })
    const listed = await invoke(mcpChannels.list)

    for (const answer of [added, updated, listed]) {
      expect(JSON.stringify(answer)).not.toContain('lin_api_supersecret')
      expect(JSON.stringify(answer)).not.toContain('another_one')
    }
    expect(listed).toMatchObject({ ok: true, value: [{ hasSecret: true }] })
  })

  it('reports the engine’s own words when a server is refused', async () => {
    const { invoke } = setup()
    await invoke(mcpChannels.add, LINEAR)

    expect(await invoke(mcpChannels.add, LINEAR)).toEqual({
      ok: false,
      error: expect.stringMatching(/already has a server named linear/i),
    })
    expect(await invoke(mcpChannels.add, { name: 'x' })).toEqual({
      ok: false,
      error: expect.stringMatching(/needs a name and a transport/i),
    })
  })

  it('says what removing a server takes with it, then takes it', async () => {
    const { engine, invoke } = setup()
    const added = (await invoke(mcpChannels.add, LINEAR)) as { value: { id: string } }
    const role = engine.roles.ensure(['backend'])[0]!
    await invoke(staffChannels.updateRole, role.id, { mcpServers: [added.value.id] })
    await invoke(staffChannels.hire, { name: 'Ada', roleId: role.id })

    expect(await invoke(mcpChannels.impact, added.value.id)).toEqual({
      ok: true,
      value: { name: 'linear', employees: 1, roles: 1 },
    })
    expect(await invoke(mcpChannels.remove, added.value.id)).toEqual({ ok: true, value: null })
    expect(engine.employees.list()[0]!.mcpServers).toEqual([])
  })

  it('lets the renderer grant a server to one Employee, and refuses one this Company has not got', async () => {
    const { engine, invoke } = setup()
    const added = (await invoke(mcpChannels.add, LINEAR)) as { value: { id: string } }
    const hired = (await invoke(staffChannels.hire, { name: 'Ada', roleId: 'backend' })) as {
      value: { id: string }
    }

    await invoke(staffChannels.updateEmployee, hired.value.id, { mcpServers: [added.value.id] })
    expect(engine.employees.list()[0]!.mcpServers).toEqual([added.value.id])

    expect(await invoke(staffChannels.updateEmployee, hired.value.id, { mcpServers: ['nope'] })).toEqual({
      ok: false,
      error: expect.stringMatching(/Unknown MCP server/i),
    })
  })

  /**
   * Import from Claude Code (T235). The scan is a list of names and the import is a list of names:
   * the renderer never holds a value, so there is none for it to leak, log or send back.
   */
  it('scans the boss’s own config and hands the renderer names, never a value', async () => {
    const { invoke } = setup()

    const scan = (await invoke(mcpChannels.importScan, 'claude')) as {
      ok: true
      value: { servers: { name: string }[] }
    }

    expect(scan.value.servers.map((server) => server.name)).toEqual(['pencil', 'github', 'linear'])
    expect(JSON.stringify(scan)).not.toContain('ghp_supersecret')
    expect(JSON.stringify(scan)).not.toContain('lin_supersecret')
  })

  it('imports the ticked servers, with their values in the store and not in the answer', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)
    await invoke(mcpChannels.importScan, 'claude')

    const imported = (await invoke(mcpChannels.importServers, 'claude', ['github', 'linear'])) as {
      ok: true
      value: { id: string; name: string }[]
    }

    expect(imported.value.map((server) => server.name)).toEqual(['github', 'linear'])
    expect(JSON.stringify(imported)).not.toContain('ghp_supersecret')
    const companyId = engine.currentCompany()!.id
    const github = imported.value[0]!
    expect(secrets.read(companyId, `${github.id}:GITHUB_TOKEN`)).toBe('ghp_supersecret')
    expect(secrets.read(companyId, imported.value[1]!.id)).toBe('lin_supersecret')
    expect(engine.mcp.list().map((server) => server.name)).toEqual(['github', 'linear'])
  })

  it('refuses a name the scan did not offer, and imports nothing at all when one of them is wrong', async () => {
    const { engine, invoke } = setup()
    await invoke(mcpChannels.importScan, 'claude')

    expect(await invoke(mcpChannels.importServers, 'claude', ['github', 'invented'])).toEqual({
      ok: false,
      error: expect.stringMatching(/not one of the servers just read/i),
    })
    expect(engine.mcp.list()).toEqual([])
  })

  /**
   * The scan refuses a name the Company already has, so the dialog cannot tick it — and this is
   * the other half: a server added *after* the scan is still refused, rather than shadowing the
   * one the Company has.
   */
  it('refuses to import a name this Company took while the dialog was open', async () => {
    const { invoke } = setup()
    await invoke(mcpChannels.importScan, 'claude')
    await invoke(mcpChannels.add, LINEAR)

    expect(await invoke(mcpChannels.importServers, 'claude', ['linear'])).toEqual({
      ok: false,
      error: expect.stringMatching(/already has a server named linear/i),
    })
  })

  it('lists what the tools on this machine hold, by tool, and carries not one value (T242)', async () => {
    const { invoke } = setup()

    const found = await invoke(mcpChannels.found)

    expect(found).toMatchObject({
      ok: true,
      value: [
        { source: 'codex', servers: [{ name: 'warehouse', secretNames: ['DATABASE_URL'], added: false }] },
        { source: 'cursor', servers: [{ name: 'supabase', hasToken: true, added: false }] },
        // A header-authenticated server is listed by the names of its headers, never their values (T245).
        { source: 'vscode', servers: [{ name: 'datadog', secretNames: ['DD_API_KEY'], added: false }] },
      ],
    })
    expect(JSON.stringify(found)).not.toContain('hunter2')
    expect(JSON.stringify(found)).not.toContain('sbp_supersecret')
    expect(JSON.stringify(found)).not.toContain('dd_supersecret')
  })

  it('adds one found server, with its values in the store and not in the answer', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)
    await invoke(mcpChannels.found)

    const added = (await invoke(mcpChannels.addFound, 'codex', 'warehouse')) as { ok: true; value: { id: string } }

    expect(added).toMatchObject({ ok: true, value: { name: 'warehouse', hasSecret: false } })
    expect(JSON.stringify(added)).not.toContain('hunter2')
    const companyId = engine.currentCompany()!.id
    expect(secrets.read(companyId, `${added.value.id}:DATABASE_URL`)).toBe('postgres://boss:hunter2@db/acme')
  })

  it('says a found server is already there once the Company has it, and refuses to add it twice', async () => {
    const { invoke } = setup()
    await invoke(mcpChannels.found)
    await invoke(mcpChannels.addFound, 'cursor', 'supabase')

    expect(await invoke(mcpChannels.found)).toMatchObject({
      ok: true,
      value: [
        { source: 'codex' },
        { source: 'cursor', servers: [{ name: 'supabase', added: true }] },
        { source: 'vscode' },
      ],
    })
    expect(await invoke(mcpChannels.addFound, 'cursor', 'supabase')).toEqual({
      ok: false,
      error: expect.stringMatching(/not one of the servers just found/i),
    })
  })

  it('refuses a tool it cannot read and a name the scan did not offer', async () => {
    const { engine, invoke } = setup()
    await invoke(mcpChannels.found)

    expect(await invoke(mcpChannels.addFound, 'made-up', 'supabase')).toMatchObject({ ok: false })
    expect(await invoke(mcpChannels.addFound, 'cursor', 'invented')).toMatchObject({ ok: false })
    expect(engine.mcp.list()).toEqual([])
  })

  it('adds a preset, with what the boss typed in the store and not in the answer (T242)', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)

    const added = (await invoke(mcpChannels.addPreset, 'github', 'github', { token: 'ghp_typed_in' })) as {
      ok: true
      value: { id: string }
    }

    expect(added).toMatchObject({ ok: true, value: { name: 'github', transport: 'http', hasSecret: true } })
    expect(JSON.stringify(added)).not.toContain('ghp_typed_in')
    expect(secrets.read(engine.currentCompany()!.id, added.value.id)).toBe('ghp_typed_in')
  })

  it('puts a preset’s stdio secret under its own variable, and nothing of it in the database', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)

    const added = (await invoke(mcpChannels.addPreset, 'sentry', 'sentry', {
      SENTRY_ACCESS_TOKEN: 'sntryu_typed_in',
    })) as { ok: true; value: { id: string } }

    expect(secrets.read(engine.currentCompany()!.id, `${added.value.id}:SENTRY_ACCESS_TOKEN`)).toBe('sntryu_typed_in')
    expect(JSON.stringify(engine.mcp.list())).not.toContain('sntryu_typed_in')
  })

  it('puts a preset’s header keys in the store and the header names in the row (T245)', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)

    const added = (await invoke(mcpChannels.addPreset, 'datadog', 'datadog', {
      site: 'datadoghq.eu',
      DD_API_KEY: 'dd_api_typed_in',
      DD_APPLICATION_KEY: 'dd_app_typed_in',
    })) as { ok: true; value: { id: string } }

    const companyId = engine.currentCompany()!.id
    expect(added).toMatchObject({
      ok: true,
      value: {
        name: 'datadog',
        url: 'https://mcp.datadoghq.eu/v1/mcp',
        headerSecretNames: ['DD_API_KEY', 'DD_APPLICATION_KEY'],
        hasSecret: false,
      },
    })
    // Neither key is in what the renderer is answered with, and neither is in the database.
    expect(JSON.stringify(added)).not.toContain('typed_in')
    expect(JSON.stringify(engine.mcp.list())).not.toContain('typed_in')
    expect(secrets.read(companyId, `${added.value.id}:DD_API_KEY`)).toBe('dd_api_typed_in')
    expect(secrets.read(companyId, `${added.value.id}:DD_APPLICATION_KEY`)).toBe('dd_app_typed_in')
  })

  it('refuses a preset it does not have, one filled in wrong, and one whose name is taken', async () => {
    const { engine, invoke } = setup()
    await invoke(mcpChannels.addPreset, 'playwright', 'playwright', {})

    expect(await invoke(mcpChannels.addPreset, 'invented', 'x', {})).toEqual({
      ok: false,
      error: expect.stringMatching(/no preset called invented/i),
    })
    expect(await invoke(mcpChannels.addPreset, 'github', 'github', {})).toEqual({
      ok: false,
      error: expect.stringMatching(/needs personal access token/i),
    })
    expect(await invoke(mcpChannels.addPreset, 'playwright', 'playwright', {})).toEqual({
      ok: false,
      error: expect.stringMatching(/already has a server named playwright/i),
    })
    expect(engine.mcp.list().map((server) => server.name)).toEqual(['playwright'])
  })

  it('adds a header-authenticated server found on this machine, with its header value in the store', async () => {
    const secrets = memorySecrets()
    const { engine, invoke } = setup(secrets)
    await invoke(mcpChannels.found)

    const added = (await invoke(mcpChannels.addFound, 'vscode', 'datadog')) as { ok: true; value: { id: string } }

    const companyId = engine.currentCompany()!.id
    expect(added).toMatchObject({ ok: true, value: { name: 'datadog', headerSecretNames: ['DD_API_KEY'] } })
    expect(JSON.stringify(added)).not.toContain('dd_supersecret')
    expect(secrets.read(companyId, `${added.value.id}:DD_API_KEY`)).toBe('dd_supersecret')
  })

  it('broadcasts every change, so the settings card and the hire form redraw', async () => {
    const { invoke, broadcasts } = setup()
    const before = broadcasts()

    const added = (await invoke(mcpChannels.add, LINEAR)) as { value: { id: string } }
    const afterAdd = broadcasts()
    await invoke(mcpChannels.remove, added.value.id)

    expect(afterAdd).toBeGreaterThan(before)
    expect(broadcasts()).toBeGreaterThan(afterAdd)
  })
})
