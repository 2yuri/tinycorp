import { afterEach, describe, expect, it } from 'vitest'
import { activityChannels } from '../../../shared/domain/channels'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerActivityIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    log: () => {},
  })
  engines.push(engine)
  let broadcasts = 0
  registerActivityIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)

  function withActivity() {
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const ticket = engine.board().createTicket({ title: 'Login page' })
    engine.chat().post({ authorId: ada.id, channelId: 'general', text: 'on it' })
    return { ada, ticket }
  }

  return { engine, invoke, withActivity, broadcasts: () => broadcasts }
}

describe('Activity IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(activityChannels.list)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists the log newest first and broadcasts when an event lands', async () => {
    const { invoke, withActivity, broadcasts } = setup()

    withActivity()

    expect(await invoke(activityChannels.list)).toMatchObject({
      ok: true,
      value: [{ kind: 'message_posted' }, { kind: 'ticket_created' }],
    })
    expect(broadcasts()).toBeGreaterThan(0)
  })

  it('applies the kind, Employee and search filters', async () => {
    const { invoke, withActivity } = setup()
    const { ada, ticket } = withActivity()

    expect(await invoke(activityChannels.list, { groups: ['tickets'] })).toMatchObject({
      ok: true,
      value: [{ kind: 'ticket_created' }],
    })
    expect(await invoke(activityChannels.list, { actorId: ada.id })).toMatchObject({
      ok: true,
      value: [{ kind: 'message_posted' }],
    })
    expect(await invoke(activityChannels.list, { search: `AC-${ticket.id}` })).toMatchObject({
      ok: true,
      value: [{ kind: 'ticket_created' }],
    })
  })

  it('lists the actors for the Employee filter', async () => {
    const { invoke, withActivity } = setup()
    const { ada } = withActivity()

    expect(await invoke(activityChannels.actors)).toEqual({
      ok: true,
      value: [
        { id: ada.id, name: 'Ada' },
        { id: BOSS, name: 'Boss' },
      ],
    })
  })

  it('refuses a filter it does not know', async () => {
    const { invoke, withActivity } = setup()
    withActivity()

    expect(await invoke(activityChannels.list, { groups: ['spend'] })).toEqual({
      ok: false,
      error: expect.stringMatching(/unknown kind filter/i),
    })
    expect(await invoke(activityChannels.list, { limit: 0 })).toEqual({
      ok: false,
      error: expect.stringMatching(/count/i),
    })
    expect(await invoke(activityChannels.list, 'everything')).toEqual({
      ok: false,
      error: expect.stringMatching(/object/i),
    })
  })
})
