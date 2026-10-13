import { afterEach, describe, expect, it } from 'vitest'
import { sessionChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerSessionIpc } from './ipc'

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
  registerSessionIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, provider, invoke, broadcasts: () => broadcasts }
}

describe('Session IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(sessionChannels.list)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('starts and stops an Employee’s Session and lists its status', async () => {
    const { engine, provider, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const started = await invoke(sessionChannels.start, ada.id)
    provider.spawnOf(ada.id).hook('UserPromptSubmit')
    const listed = await invoke(sessionChannels.list)
    const stopped = await invoke(sessionChannels.stop, ada.id)

    expect(started).toMatchObject({ ok: true, value: { employeeId: ada.id, status: 'starting' } })
    expect(listed).toMatchObject({ ok: true, value: [{ employeeId: ada.id, status: 'busy' }] })
    expect(stopped).toMatchObject({ ok: true, value: { status: 'off' } })
    expect(broadcasts()).toBe(3)
  })

  it('pauses and resumes the current Company', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(sessionChannels.start, ada.id)

    expect(await invoke(sessionChannels.paused)).toEqual({ ok: true, value: false })
    expect(await invoke(sessionChannels.pauseAll)).toEqual({ ok: true, value: true })
    expect(await invoke(sessionChannels.list)).toMatchObject({ ok: true, value: [{ status: 'off' }] })
    expect(await invoke(sessionChannels.start, ada.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/paused/),
    })
    expect(await invoke(sessionChannels.resumeAll)).toEqual({
      ok: true,
      value: { paused: false, resumed: [ada.id], failed: [], from: 'held' },
    })
    expect(provider.spawnOf(ada.id).request.resume).toBe(true)
  })

  /*
   * T217. The channel used to answer only whether the Company was still paused, so a resume that
   * brought nobody back was indistinguishable over the IPC from one that brought the whole team —
   * and the renderer had nothing to say to the boss.
   */
  it('says a resume brought nobody back, rather than only that the pause is lifted', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(sessionChannels.pauseAll)

    expect(await invoke(sessionChannels.resumeAll)).toEqual({
      ok: true,
      value: { paused: false, resumed: [], failed: [], from: 'nobody' },
    })
  })

  it('rejects malformed input from the renderer', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(sessionChannels.start, 42)).toMatchObject({ ok: false })
    expect(await invoke(sessionChannels.stop)).toMatchObject({ ok: false })
    expect(await invoke(sessionChannels.start, 'nobody')).toMatchObject({ ok: false })
  })
})

describe('the handoff command over IPC (T164)', () => {
  it('hands the renderer a line to copy, and null before the Employee has had a Session', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(await invoke(sessionChannels.handoffCommand, ada.id)).toEqual({ ok: true, value: null })

    await invoke(sessionChannels.start, ada.id)
    const sessionId = provider.spawnOf(ada.id).request.sessionId

    // The renderer never assembles this: it names no Provider and no flag (`no-provider-names`).
    expect(await invoke(sessionChannels.handoffCommand, ada.id)).toEqual({
      ok: true,
      value: { command: `fake-cli --resume ${sessionId} --skip-permissions`, shown: expect.any(String) },
    })
  })

  it('starts nothing: asking for the command leaves every Session where it was', async () => {
    const { engine, provider, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    await invoke(sessionChannels.start, ada.id)
    await invoke(sessionChannels.stop, ada.id)
    const spawns = provider.spawns.length

    await invoke(sessionChannels.handoffCommand, ada.id)

    expect(provider.spawns).toHaveLength(spawns)
    expect(await invoke(sessionChannels.list)).toMatchObject({ ok: true, value: [{ status: 'off' }] })
  })
})
