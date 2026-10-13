import { afterEach, describe, expect, it } from 'vitest'
import { answererChannels } from '../../../shared/domain/channels'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerAnswererIpc } from './answerer-ipc'

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
  let broadcasts = 0
  registerAnswererIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Answerer IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(answererChannels.get)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads Automatic, sets an Employee and goes back to Automatic', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const automatic = await invoke(answererChannels.get)
    const chosen = await invoke(answererChannels.set, ada.id)
    const back = await invoke(answererChannels.set, null)

    expect(automatic).toMatchObject({ ok: true, value: { overrideId: null, waitingForId: pam.id } })
    expect(chosen).toMatchObject({ ok: true, value: { overrideId: ada.id } })
    expect(back).toMatchObject({ ok: true, value: { overrideId: null } })
  })

  it('routes the next boss message to the Employee set over IPC', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    engine.employees.create({ name: 'Pam', roleId: 'pm' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    await invoke(answererChannels.set, ada.id)
    engine.chat().post({ authorId: BOSS, channelId: 'general', text: 'how is it going?' })

    expect(engine.inbox.list(ada.id).map((i) => i.kind)).toEqual(['intake'])
  })

  it('refuses anything but an Employee id or null', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(answererChannels.set, 7)).toMatchObject({ ok: false })
    expect(await invoke(answererChannels.set, 'nobody')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown employee/i),
    })
  })

  it('broadcasts on answerer changes and on Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = broadcasts()

    await invoke(answererChannels.set, ada.id)
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })
})
