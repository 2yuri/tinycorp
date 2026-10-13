import { afterEach, describe, expect, it } from 'vitest'
import { inboxChannels } from '../../../shared/domain/channels'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerInboxIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  let broadcasts = 0
  registerInboxIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Inbox IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(inboxChannels.list, 'someone')).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists an Employee’s inbox', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada.id), text: 'ping' })

    expect(await invoke(inboxChannels.list, ada.id)).toEqual({
      ok: true,
      value: [expect.objectContaining({ kind: 'dm', text: 'ping', status: 'pending' })],
    })
  })

  it('broadcasts on inbox changes and on Company changes', async () => {
    const { engine, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = broadcasts()

    engine.chat().post({ authorId: BOSS, channelId: 'tech', text: '@Ada hi' })
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })

  it('rejects a missing Employee id', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(inboxChannels.list, 42)).toMatchObject({ ok: false })
  })
})
