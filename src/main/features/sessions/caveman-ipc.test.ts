import { afterEach, describe, expect, it } from 'vitest'
import type { CavemanLevel } from '../../../shared/caveman'
import { cavemanChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerCavemanIpc } from './caveman-ipc'

/**
 * The Add-ons tab's half of Caveman (T261), over the seam.
 *
 * What it has to keep true: the boss's choice reaches the next Session's instructions, and a value
 * the app does not know never reaches the table.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  registerCavemanIpc({ ipc, engine })
  const invoke = async <T>(channel: string, ...args: unknown[]) => (await handlers.get(channel)!(...args)) as Result<T>

  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  return { engine, provider, invoke, ada }
}

describe('Caveman over IPC', () => {
  it('reads off for a Company that has never been asked', async () => {
    const { invoke } = setup()

    expect(await invoke<CavemanLevel>(cavemanChannels.get)).toEqual({ ok: true, value: 'off' })
  })

  it('round-trips each intensity', async () => {
    const { invoke } = setup()

    for (const level of ['lite', 'full', 'ultra'] as const) {
      expect(await invoke<CavemanLevel>(cavemanChannels.set, level)).toEqual({ ok: true, value: level })
      expect(await invoke<CavemanLevel>(cavemanChannels.get)).toEqual({ ok: true, value: level })
    }
  })

  it('refuses a level it does not know, and keeps the saved one', async () => {
    const { invoke } = setup()

    const refusal = await invoke<CavemanLevel>(cavemanChannels.set, 'wenyan')

    expect(refusal).toEqual({ ok: false, error: expect.stringContaining('Unknown caveman level') })
    expect(await invoke<CavemanLevel>(cavemanChannels.get)).toEqual({ ok: true, value: 'off' })
  })

  it('reaches the instructions the next Session opens with, not only the setting', async () => {
    const { engine, provider, invoke, ada } = setup()

    await invoke(cavemanChannels.set, 'full')
    engine.sessions.start(ada.id)

    expect(provider.spawnOf(ada.id).instructions?.text).toContain('## How you answer the boss')
  })
})
