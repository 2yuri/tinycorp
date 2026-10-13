import { afterEach, describe, expect, it } from 'vitest'
import { terminalChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerTerminalIpc, type TerminalIpcRegistry, type TerminalSender } from './terminal-ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

interface FakeWindow extends TerminalSender {
  /** Every `terminals:data` message, as [employeeId, data]. */
  received: [string, string][]
  close(): void
}

let nextWindowId = 1
function fakeWindow(): FakeWindow {
  const onDestroyed: (() => void)[] = []
  let destroyed = false
  const window: FakeWindow = {
    id: nextWindowId++,
    received: [],
    send(channel, employeeId, data) {
      if (destroyed) throw new Error('Object has been destroyed')
      if (channel === terminalChannels.data) window.received.push([employeeId, data])
    },
    isDestroyed: () => destroyed,
    once(_event, listener) {
      onDestroyed.push(listener)
    },
    close() {
      destroyed = true
      for (const listener of onDestroyed) listener()
    },
  }
  return window
}

function setup() {
  const handlers = new Map<string, Parameters<TerminalIpcRegistry['handle']>[1]>()
  const ipc: TerminalIpcRegistry = {
    handle: (channel, handler) => handlers.set(channel, handler),
  }
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  registerTerminalIpc({ ipc, engine })
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({
    name: 'Ada',
    roleId: 'backend',
    permissionMode: 'interactive',
  })
  const invoke = async (window: FakeWindow, channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({ sender: window }, ...args)
  return { engine, provider, ada, invoke }
}

describe('Terminal IPC', () => {
  it('replays and then streams an Employee’s terminal to the window that opened it', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const pty = provider.spawnOf(ada.id).pty
    pty.output('before ')
    const window = fakeWindow()

    const attached = await invoke(window, terminalChannels.attach, ada.id)
    pty.output('after')

    expect(attached).toEqual({ ok: true, value: 'before ' })
    expect(window.received).toEqual([[ada.id, 'after']])
  })

  it('forwards typing, including a permission prompt answer, to the Session', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const window = fakeWindow()
    await invoke(window, terminalChannels.attach, ada.id)

    const typed = await invoke(window, terminalChannels.write, ada.id, '2')
    await invoke(window, terminalChannels.write, ada.id, '\r')

    expect(typed).toEqual({ ok: true, value: null })
    expect(provider.spawnOf(ada.id).pty.written).toEqual(['2', '\r'])
  })

  it('resizes the Session’s PTY when the drawer is resized', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const window = fakeWindow()

    const resized = await invoke(window, terminalChannels.resize, ada.id, 132, 43)

    expect(resized).toEqual({ ok: true, value: null })
    expect(provider.spawnOf(ada.id).pty.size).toEqual({ cols: 132, rows: 43 })
  })

  it('stops streaming after the drawer detaches', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const window = fakeWindow()
    await invoke(window, terminalChannels.attach, ada.id)

    await invoke(window, terminalChannels.detach, ada.id)
    provider.spawnOf(ada.id).pty.output('ignored')

    expect(window.received).toEqual([])
  })

  it('streams once per window however often the drawer re-attaches', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const window = fakeWindow()
    await invoke(window, terminalChannels.attach, ada.id)
    await invoke(window, terminalChannels.attach, ada.id)

    provider.spawnOf(ada.id).pty.output('once')

    expect(window.received).toEqual([[ada.id, 'once']])
  })

  it('streams to every window that attached', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const first = fakeWindow()
    const second = fakeWindow()
    await invoke(first, terminalChannels.attach, ada.id)
    await invoke(second, terminalChannels.attach, ada.id)

    provider.spawnOf(ada.id).pty.output('hi')

    expect(first.received).toEqual([[ada.id, 'hi']])
    expect(second.received).toEqual([[ada.id, 'hi']])
  })

  it('stops streaming to a window once it is closed', async () => {
    const { engine, provider, ada, invoke } = setup()
    engine.sessions.start(ada.id)
    const window = fakeWindow()
    await invoke(window, terminalChannels.attach, ada.id)

    window.close()

    expect(() => provider.spawnOf(ada.id).pty.output('late')).not.toThrow()
    expect(window.received).toEqual([])
  })

  it('rejects malformed input from the renderer', async () => {
    const { ada, invoke } = setup()
    const window = fakeWindow()

    expect(await invoke(window, terminalChannels.attach, 42)).toMatchObject({ ok: false })
    expect(await invoke(window, terminalChannels.write, ada.id, 7)).toMatchObject({ ok: false })
    expect(await invoke(window, terminalChannels.resize, ada.id, 'wide', 10)).toMatchObject({
      ok: false,
    })
    expect(await invoke(window, terminalChannels.resize, ada.id, -1, 10)).toMatchObject({
      ok: false,
    })
  })
})
