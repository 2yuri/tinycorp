/**
 * Closing the window is not quitting (T117): the engine, and every Session it holds, is put through
 * the real thing here — a Company on disk, a fake Provider, and an `app` that only records what it
 * was asked to do.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { READY_DELAY_MS } from '../../features/sessions/sessions'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { type BackgroundApp, runInBackground } from './background'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** Electron's `app`, as far as the background can tell: the events fire when the test says so. */
function fakeApp() {
  const listeners = new Map<string, () => void>()
  const dock = { hidden: false, hide: vi.fn(), show: vi.fn() }
  return {
    dock,
    quits: 0,
    on(event: string, listener: () => void) {
      listeners.set(event, listener)
    },
    quit(this: { quits: number }) {
      this.quits += 1
      listeners.get('will-quit')?.()
    },
    emit(event: 'window-all-closed' | 'activate') {
      listeners.get(event)?.()
    },
  }
}

/** One run of the app: a Company whose Employees all have a Session that got ready. */
function launch(names: string[]) {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-background-'))
  folders.push(folder)
  const provider: FakeProvider = fakeProvider()
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: provider },
    notesFiles: inMemoryNotesFiles(),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder, name: 'Acme' })
  const team = names.map((name) => engine.employees.create({ name, roleId: 'backend' }))
  for (const employee of team) {
    engine.sessions.start(employee.id)
    provider.spawnOf(employee.id).hook('SessionStart', { source: 'startup' })
  }
  vi.advanceTimersByTime(READY_DELAY_MS)

  const app = fakeApp()
  let windows = 1
  const opened: string[] = []
  const background = runInBackground({
    app: app as unknown as BackgroundApp,
    platform: 'darwin',
    hasMenuBarItem: true,
    windowCount: () => windows,
    openWindow: () => {
      windows = 1
      const window = `window-${opened.length + 1}`
      opened.push(window)
      return window
    },
    shutdown: () => engine.close(),
  })
  return {
    app,
    engine,
    provider,
    background,
    ids: team.map((e) => e.id),
    opened,
    closeWindow() {
      windows = 0
      app.emit('window-all-closed')
    },
  }
}

const statuses = (engine: CompanyEngine) => engine.sessions.list().map((s) => s.status)

describe('closing the last window', () => {
  it('does not quit: the app keeps running in the menu bar', () => {
    const run = launch(['Ada', 'Grace'])

    run.closeWindow()

    expect(run.app.quits).toBe(0)
    expect(run.background.inBackground()).toBe(true)
  })

  it('leaves every Session running and the engine alive', () => {
    const run = launch(['Ada', 'Grace'])

    run.closeWindow()

    expect(statuses(run.engine)).toEqual(['idle', 'idle'])
    expect(run.ids.map((id) => run.provider.spawnOf(id).pty.killed)).toEqual([false, false])
    // The engine still answers, which is what the menu-bar item reads while there is no window.
    expect(run.engine.currentCompany()?.name).toBe('Acme')
    expect(run.engine.capacity.get().running).toBe(2)
  })

  it('takes the Dock icon with it, and brings it back with the window', () => {
    const run = launch(['Ada'])

    run.closeWindow()
    expect(run.app.dock.hide).toHaveBeenCalled()

    // Whoever asks for the app back gets the window itself, so a notification can be sent to it.
    expect(run.background.open()).toBe('window-1')
    expect(run.app.dock.show).toHaveBeenCalled()
    expect(run.opened).toEqual(['window-1'])
    expect(run.background.inBackground()).toBe(false)
  })

  it('brings a window back when the boss clicks the Dock icon', () => {
    const run = launch(['Ada'])
    run.closeWindow()

    run.app.emit('activate')

    expect(run.opened).toEqual(['window-1'])
  })

  it('quits anyway when there is no menu-bar item to come back through', () => {
    const run = launch(['Ada'])
    const app = fakeApp()
    runInBackground({
      app: app as unknown as BackgroundApp,
      platform: 'linux',
      hasMenuBarItem: false,
      windowCount: () => 0,
      openWindow: () => 'window',
      shutdown: () => run.engine.close(),
    })

    app.emit('window-all-closed')

    expect(app.quits).toBe(1)
  })
})

describe('quitting for real', () => {
  it('stops every Session and closes the engine, window or no window', () => {
    const run = launch(['Ada', 'Grace'])
    run.closeWindow()

    run.background.quit()

    expect(run.app.quits).toBe(1)
    expect(run.ids.map((id) => run.provider.spawnOf(id).pty.killed)).toEqual([true, true])
    expect(run.engine.currentCompany()).toBeNull()
    engines.splice(engines.indexOf(run.engine), 1)
  })
})
