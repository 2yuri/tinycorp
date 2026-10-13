/**
 * The item over a real engine: what it says, and that the calls behind its rows are the very ones
 * the app makes (T117).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuCommand } from '../../../shared/app/menu'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { READY_DELAY_MS } from '../../features/sessions/sessions'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { createMenuBar, engineTrayFacts, type MenuBarItem, watchEngine } from './menu-bar'
import type { TrayMenuItem } from './tray-menu'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** Electron's `Tray`, as far as the item can tell. */
function fakeItem() {
  const state = { tooltip: '', menu: [] as TrayMenuItem[], destroyed: false }
  const item: MenuBarItem = {
    setToolTip: (text) => {
      state.tooltip = text
    },
    setContextMenu: (menu) => {
      state.menu = menu
    },
    destroy: () => {
      state.destroyed = true
    },
  }
  return { item, state, row: (label: string) => state.menu.find((one) => one.label === label) }
}

function launch(names: string[]) {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-menu-bar-'))
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

  const tray = fakeItem()
  const opened: (string | null)[] = []
  /*
   * What `src/main/index.ts` wires these rows to. `Pause all` is the engine call, because pausing
   * from the menu bar is how the boss puts the floor down without opening the app; `Resume all` is
   * the window's own command, because a resume can have something to say and the menu bar has
   * nowhere to say it (T217).
   */
  const sent: MenuCommand[] = []
  const bar = createMenuBar({
    item: tray.item,
    facts: () => engineTrayFacts(engine),
    watch: watchEngine(engine),
    actions: {
      open: (id) => opened.push(id),
      pauseAll: () => engine.sessions.stopAll(),
      resumeAll: () => sent.push({ kind: 'resume-all' }),
      quit: () => {},
    },
  })
  return { engine, provider, tray, bar, opened, sent, ids: team.map((e) => e.id) }
}

/** The app at launch: the engine is up and the Launcher has not opened a Company yet. */
function launchWithNoCompany() {
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: fakeProvider() },
    notesFiles: inMemoryNotesFiles(),
    log: () => {},
  })
  engines.push(engine)
  const tray = fakeItem()
  const bar = createMenuBar({
    item: tray.item,
    facts: () => engineTrayFacts(engine),
    watch: watchEngine(engine),
    actions: { open: () => {}, pauseAll: () => {}, resumeAll: () => {}, quit: () => {} },
  })
  return { engine, tray, bar }
}

describe('the menu-bar item before any Company is open', () => {
  it('says so instead of asking the engine for a floor there is none of', () => {
    const run = launchWithNoCompany()

    expect(run.tray.state.tooltip).toBe('No Company open')
    expect(run.bar.summary()).toMatchObject({ company: null, atWork: 0, canPause: false })
  })

  it('offers the app itself, and nothing to pause', () => {
    const run = launchWithNoCompany()

    expect(run.tray.row('Open TinyCorp')).toBeDefined()
    expect(run.tray.row('Pause all')?.enabled).toBe(false)
  })

  it('names the Company the moment one is opened', () => {
    const run = launchWithNoCompany()
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-menu-bar-'))
    folders.push(folder)

    run.engine.createCompany({ folder, name: 'Globex' })

    expect(run.tray.state.tooltip).toBe('Globex · 0 at work')
    expect(run.tray.row('Open Globex')).toBeDefined()
  })
})

describe('the menu-bar item over a live engine', () => {
  it('says the open Company and how many are at work', () => {
    const run = launch(['Ada', 'Grace'])

    expect(run.tray.state.tooltip).toBe('Acme · 2 at work')
    expect(run.bar.summary()).toMatchObject({ company: 'Acme', atWork: 2, waitingOnYou: 0 })
  })

  it('reads again on its own when a Session stops', () => {
    const run = launch(['Ada', 'Grace'])

    run.engine.sessions.stop(run.ids[0]!)

    expect(run.bar.summary().atWork).toBe(1)
    expect(run.tray.state.tooltip).toBe('Acme · 1 at work')
  })

  it('counts an Employee whose Approval the boss has not decided', () => {
    const run = launch(['Ada'])
    run.engine.approvals.setLevel('supervised')
    run.engine.approvals.request({ requesterId: run.ids[0]!, action: 'other', subject: 'Drop the users table' })

    expect(run.bar.summary().waitingOnYou).toBe(1)
    expect(run.tray.state.tooltip).toBe('Acme · 1 at work · 1 waiting on you')
  })

  it('pauses the Company from its own row, exactly as the app does', () => {
    const run = launch(['Ada', 'Grace'])

    run.tray.row('Pause all')?.click?.()

    expect(run.engine.sessions.paused()).toBe(true)
    expect(run.engine.sessions.list().map((s) => s.status)).toEqual(['off', 'off'])
    expect(run.tray.row('Resume all')).toBeDefined()
  })

  /*
   * T217: the item used to call `startAll` itself, so a resume that brought nobody back — a pause
   * that held nobody — happened in silence with no window and no words anywhere.
   */
  it('resumes through the window’s own command, so the boss reads what the resume came to', () => {
    const run = launch(['Ada'])
    run.tray.row('Pause all')?.click?.()

    run.tray.row('Resume all')?.click?.()

    expect(run.sent).toEqual([{ kind: 'resume-all' }])
  })

  it('offers the open Company to reopen', () => {
    const run = launch(['Ada'])

    run.tray.row('Open Acme')?.click?.()

    expect(run.opened).toEqual([run.engine.currentCompany()?.id])
  })

  it('lets go of the engine when it is closed', () => {
    const run = launch(['Ada'])

    run.bar.close()

    expect(run.tray.state.destroyed).toBe(true)
    // No listener is left behind, so a later change cannot reach a destroyed item.
    expect(() => run.engine.sessions.stop(run.ids[0]!)).not.toThrow()
  })
})
