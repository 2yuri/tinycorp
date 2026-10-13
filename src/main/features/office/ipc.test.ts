import { afterEach, describe, expect, it } from 'vitest'
import { officeChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerOfficeIpc } from './ipc'

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
  registerOfficeIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, provider, invoke, broadcasts: () => broadcasts }
}

describe('Office IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(officeChannels.facts)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('returns the facts the office is projected from', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('PreToolUse', { tool_name: 'Grep' })
    engine.board().createTicket({ title: 'Login', assigneeId: ada.id })

    expect(await invoke(officeChannels.facts)).toEqual({
      ok: true,
      value: {
        room: 'night-studio',
        sessions: { [ada.id]: 'busy' },
        activity: { [ada.id]: { tool: 'Grep', posts: [] } },
        approvals: [],
        asking: [],
        routed: {},
        tickets: [expect.objectContaining({ assigneeId: ada.id, blocked: false, column: 'planning' })],
      },
    })
  })

  it('picks the room, and refuses anything that is not one', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    expect(await invoke(officeChannels.room)).toEqual({ ok: true, value: 'night-studio' })
    expect(await invoke(officeChannels.setRoom, 'night-studio')).toEqual({ ok: true, value: 'night-studio' })
    expect(broadcasts()).toBeGreaterThan(before)
    expect(await invoke(officeChannels.setRoom, 'greenhouse')).toEqual({ ok: true, value: 'greenhouse' })
    expect(await invoke(officeChannels.setRoom, 'night-studio')).toEqual({ ok: true, value: 'night-studio' })
    expect(await invoke(officeChannels.setRoom, 7)).toEqual({
      ok: false,
      error: expect.stringMatching(/picked by its slug/i),
    })
    expect(await invoke(officeChannels.room)).toEqual({ ok: true, value: 'night-studio' })
  })

  it('broadcasts when the office changes and when the Company changes', async () => {
    const { engine, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = broadcasts()

    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'hi' })
    const afterPost = broadcasts()
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(afterPost).toBeGreaterThan(before)
    expect(broadcasts()).toBeGreaterThan(afterPost)
  })
})
