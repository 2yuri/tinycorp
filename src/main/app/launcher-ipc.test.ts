import { afterEach, describe, expect, it } from 'vitest'
import { launcherChannels } from '../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../core/testing'
import { registerLauncherIpc, type WindowSize } from './launcher-ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = { handle: (channel, handler) => handlers.set(channel, handler) }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  const resized: { event: unknown; size: WindowSize }[] = []
  registerLauncherIpc({
    ipc,
    engine,
    detectRepo: (path) => ({ path, gitRepo: path.startsWith('/git'), stack: null, commands: [] }),
    resize: (event, size) => resized.push({ event, size }),
  })
  const invoke = async (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return { engine, invoke, resized }
}

describe('Launcher IPC', () => {
  it('lists Company summaries', async () => {
    const { engine, invoke } = setup()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(launcherChannels.summaries, {})).toEqual([
      expect.objectContaining({ id: acme.id, open: true, current: true, employees: 0, sessions: 0 }),
    ])
  })

  it('detects a repo folder and refuses a missing path', async () => {
    const { invoke } = setup()

    expect(await invoke(launcherChannels.detectRepo, {}, '/git/web')).toEqual({
      ok: true,
      value: { path: '/git/web', gitRepo: true, stack: null, commands: [] },
    })
    expect(await invoke(launcherChannels.detectRepo, {}, '')).toEqual({
      ok: false,
      error: 'Missing repo path',
    })
  })

  it('resizes the sending window to the designed sizes', async () => {
    const { invoke, resized } = setup()
    const sender = { id: 1 }

    await invoke(launcherChannels.setWindowLayout, sender, 'launcher')
    await invoke(launcherChannels.setWindowLayout, sender, 'company')

    expect(resized).toEqual([
      { event: sender, size: { width: 680, height: 740, minWidth: 680, minHeight: 740 } },
      { event: sender, size: { width: 1512, height: 944, minWidth: 1024, minHeight: 640 } },
    ])
    await expect(invoke(launcherChannels.setWindowLayout, sender, 'huge')).rejects.toThrow(/layout/)
  })
})
