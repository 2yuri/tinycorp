import { afterEach, describe, expect, it } from 'vitest'
import { capacityChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerCapacityIpc } from './capacity-ipc'

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
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  let broadcasts = 0
  registerCapacityIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Capacity IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(capacityChannels.get)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads and sets the concurrency cap, parking Employees beyond it', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })

    const initial = await invoke(capacityChannels.get)
    const set = await invoke(capacityChannels.setConcurrencyCap, 1)
    engine.sessions.start(ada.id)
    engine.sessions.start(grace.id)

    expect(initial).toEqual({
      ok: true,
      value: { concurrencyCap: 5, running: 0, parked: [], budget: null, outages: [] },
    })
    expect(set).toMatchObject({ ok: true, value: { concurrencyCap: 1 } })
    expect(await invoke(capacityChannels.get)).toMatchObject({
      ok: true,
      value: { running: 1, parked: [grace.id] },
    })
  })

  it('rejects a cap that is not a positive whole number', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(capacityChannels.setConcurrencyCap, '3')).toEqual({
      ok: false,
      error: expect.stringMatching(/concurrency cap/i),
    })
    expect(await invoke(capacityChannels.setConcurrencyCap, 0)).toMatchObject({ ok: false })
  })

  it('serves usage every open Company, not just the current one', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(await invoke(capacityChannels.usage)).toEqual({
      ok: true,
      value: {
        budget: null,
        companies: [
          expect.objectContaining({ companyName: 'Acme', concurrencyCap: 5, running: 1, parked: [] }),
          expect.objectContaining({ companyName: 'Globex', concurrencyCap: 5, running: 0, parked: [] }),
        ],
      },
    })
  })

  it('broadcasts on capacity changes and on Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    await invoke(capacityChannels.setConcurrencyCap, 3)
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })
})
