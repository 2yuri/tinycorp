import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rtkChannels } from '../../../shared/domain/channels'
import { PROVIDERS, providerEntry } from '../../../shared/domain/providers'
import type { RtkView } from '../../../shared/ipc'
import { RTK_DB_ENV, RTK_TELEMETRY_ENV } from '../../../shared/rtk'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import type { CliOutcome, RunCli } from '../../platform/run-cli'
import { fakeProvider } from '../../providers/testing'
import { registerRtkIpc } from './ipc'

/**
 * The Tokens tab's half of RTK (T179), end to end through the engine: what a Company reads, what
 * its two toggles do, and what a hooked Session is really spawned with.
 *
 * No binary is run. `rtk` is a fake that answers the two questions detection asks.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const RTK = onDisk('/opt/homebrew/bin/rtk')
const DATA = onDisk('/data/rtk')
const says = (output: string): CliOutcome => ({ kind: 'output', code: 0, output })

const GAIN = JSON.stringify({
  summary: { total_commands: 9, total_input: 100, total_output: 30, total_saved: 70, avg_savings_pct: 70 },
  daily: [
    {
      date: new Date().toISOString().slice(0, 10),
      commands: 9,
      input_tokens: 100,
      output_tokens: 30,
      saved_tokens: 70,
      savings_pct: 70,
    },
  ],
})

function setup(over: { version?: string; here?: boolean } = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const runCli: RunCli = (_command, args) => {
    if (args[0] === '--version') return Promise.resolve(says(`rtk ${over.version ?? '0.41.0'}`))
    if (args[0] === 'gain' && args[1] === '--help') return Promise.resolve(says('Usage: rtk gain'))
    if (args[0] === 'gain') return Promise.resolve(says(GAIN))
    return Promise.resolve({ kind: 'missing' })
  }
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    rtk: { dir: DATA, runCli, resolve: () => (over.here === false ? null : RTK), platform: 'darwin' },
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  let broadcasts = 0
  registerRtkIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, provider, invoke, broadcasts: () => broadcasts }
}

describe('RTK IPC', () => {
  it('says where RTK stands, what this Company does with it, and how each Provider hooks in', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    const read = (await invoke(rtkChannels.read)) as { ok: true; value: RtkView }

    expect(read.value.status).toEqual({ state: 'found', version: '0.41.0', path: RTK, missingIn: [] })
    expect(read.value.settings).toEqual({ enabled: true, ping: false })
    // Every Provider in the catalogue has a row, whether or not it can rewrite a command: a row
    // that is missing is a Provider the boss cannot tell is running uncompressed.
    expect(read.value.hooks.map((row) => row.provider)).toEqual(PROVIDERS)
    expect(read.value.hooks.find((row) => row.provider === 'claude')).toEqual({
      provider: 'claude',
      name: providerEntry('claude').name,
      how: 'Bash hook · rewrites commands',
      keepsApprovals: true,
    })
  })

  it('reports an RTK that is not here, without offering to install one', async () => {
    const { engine, invoke } = setup({ here: false })
    engine.createCompany({ folder: onDisk('/work/acme') })
    const read = (await invoke(rtkChannels.read)) as { ok: true; value: { status: { state: string } } }

    expect(read.value.status.state).toBe('missing')
  })

  it('takes the two toggles, and refuses anything that is not one', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    expect(await invoke(rtkChannels.setEnabled, false)).toEqual({ ok: true, value: { enabled: false, ping: false } })
    expect(await invoke(rtkChannels.setPing, true)).toEqual({ ok: true, value: { enabled: false, ping: true } })
    expect(broadcasts()).toBeGreaterThan(before)
    expect(await invoke(rtkChannels.setEnabled, 'yes')).toEqual({
      ok: false,
      error: expect.stringMatching(/on or off/i),
    })
  })

  it('asks the machine again when the boss presses Check again', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(rtkChannels.recheck)).toEqual(await invoke(rtkChannels.read))
  })

  it('reads what RTK saved this Company, from this Company’s own history', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(rtkChannels.read)

    expect(await invoke(rtkChannels.savings)).toEqual({
      ok: true,
      value: { cutPercent: 70, tokensNotRead: 70, commandsFiltered: 9 },
    })
  })

  it('spawns a Session with this Company’s own history file and the ping blocked', async () => {
    const { engine, provider, invoke } = setup()
    const company = engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(rtkChannels.read)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    const spawned = provider.spawnOf(ada.id)
    expect(spawned.request.rtk).toEqual({
      path: RTK,
      dbPath: join(DATA, company.id, 'history.db'),
      ping: false,
    })
    expect(spawned.env[RTK_DB_ENV]).toBe(join(DATA, company.id, 'history.db'))
    expect(spawned.env[RTK_TELEMETRY_ENV]).toBe('1')
  })

  it('spawns the next Session with no RTK at all once the boss turns it off', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(rtkChannels.read)
    await invoke(rtkChannels.setEnabled, false)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).request.rtk).toBeUndefined()
  })

  it('spawns with no RTK when the one on this machine is too old', async () => {
    const { engine, provider, invoke } = setup({ version: '0.31.0' })
    engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(rtkChannels.read)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).request.rtk).toBeUndefined()
  })

  it('lets the ping out only for the Company that turned it on', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    await invoke(rtkChannels.read)
    await invoke(rtkChannels.setPing, true)
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    const spawned = provider.spawnOf(ada.id)
    expect(spawned.request.rtk?.ping).toBe(true)
    expect(spawned.env[RTK_TELEMETRY_ENV]).toBeUndefined()
  })
})
