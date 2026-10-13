import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSettingsChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { AppliedNow, StaleSession } from '../../../shared/spawn-settings'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerSpawnSettingsIpc } from './spawn-settings-ipc'

/**
 * The settings cards' two calls over the seam (T237): who is still on the old setting, and
 * `Apply now`.
 */

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
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
  const broadcasts: number[] = []
  registerSpawnSettingsIpc({ ipc, engine, broadcastChanged: () => broadcasts.push(1) })
  const invoke = async <T>(channel: string, ...args: unknown[]) => (await handlers.get(channel)!(...args)) as Result<T>

  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  return { engine, provider, invoke, ada, broadcasts }
}

describe('What a Session baked in, over IPC', () => {
  it('answers nobody while no Session is running', async () => {
    const { invoke } = setup()

    expect(await invoke<StaleSession[]>(spawnSettingsChannels.stale)).toEqual({ ok: true, value: [] })
  })

  it('names who is behind, and restarts them on Apply now', async () => {
    const { engine, provider, invoke, ada, broadcasts } = setup()
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart')
    vi.advanceTimersByTime(2000)
    engine.voice.setColleague('plain')

    const behind = await invoke<StaleSession[]>(spawnSettingsChannels.stale)
    const applied = await invoke<AppliedNow>(spawnSettingsChannels.applyNow)

    expect(behind).toEqual({
      ok: true,
      value: [{ employeeId: ada.id, name: 'Ada', busy: false, settings: ['colleagueVoice'] }],
    })
    expect(applied).toEqual({ ok: true, value: { restarted: [ada.id], waiting: [] } })
    expect(await invoke<StaleSession[]>(spawnSettingsChannels.stale)).toEqual({ ok: true, value: [] })
    // The restart is a Session moving, which is what tells every other window to read again.
    expect(broadcasts.length).toBeGreaterThan(0)
  })
})
