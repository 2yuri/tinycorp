/**
 * The menu over a real engine (#223): that it says what the engine says, that it is rebuilt the
 * moment the engine moves, and that the Companies it offers are not read on every Session change.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeepAwakeState } from '../../../shared/app/keep-awake'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { READY_DELAY_MS } from '../../features/sessions/sessions'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import type { AppMenuItem } from './app-menu'
import {
  createApplicationMenu,
  engineMenuFacts,
  engineMenuRecents,
  type MenuFacts,
  watchMenuEngine,
} from './application-menu'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

const AWAKE: KeepAwakeState = { mode: 'working', holding: false, supported: true }

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'tinycorp-app-menu-'))
  folders.push(made)
  return made
}

function newEngine() {
  const provider: FakeProvider = fakeProvider()
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: provider },
    notesFiles: inMemoryNotesFiles(),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

/** The menu over an engine, with the real facts and the real recents, counting every read. */
function run(engine: CompanyEngine, awake: () => KeepAwakeState = () => AWAKE) {
  const drawn: AppMenuItem[][] = []
  const reads = { recents: 0 }
  const menu = createApplicationMenu({
    host: { set: (items) => void drawn.push(items) },
    facts: () => engineMenuFacts(engine, awake(), 'darwin'),
    recents: () => {
      reads.recents += 1
      return engineMenuRecents(engine)
    },
    watch: watchMenuEngine(engine),
    actions: { send: () => {}, closeCompany: () => {}, setKeepAwakeMode: () => {}, openRepo: () => {} },
  })
  const submenu = (name: string): AppMenuItem[] =>
    menu.items().find((item) => (item.label ?? item.role) === name)?.submenu ?? []
  const find = (name: string, where: string) => submenu(where).find((item) => item.label === name)
  return { menu, drawn, reads, submenu, find }
}

function hire(engine: CompanyEngine, names: string[], provider: FakeProvider, start = true): string[] {
  const team = names.map((name) => engine.employees.create({ name, roleId: 'backend' }))
  if (start) {
    for (const employee of team) {
      engine.sessions.start(employee.id)
      provider.spawnOf(employee.id).hook('SessionStart', { source: 'startup' })
    }
    vi.advanceTimersByTime(READY_DELAY_MS)
  }
  return team.map((employee) => employee.id)
}

describe('what the menu reads off the engine', () => {
  it('says no Company is open before one is, without asking for a floor there is none of', () => {
    const { engine } = newEngine()

    expect(engineMenuFacts(engine, AWAKE, 'darwin')).toEqual<MenuFacts>({
      company: null,
      employees: 0,
      running: 0,
      paused: false,
      keepAwake: AWAKE,
      mac: true,
    })
  })

  it('counts the staff and the Sessions that are not off', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const ids = hire(engine, ['Ada', 'Grace'], provider)
    engine.sessions.stop(ids[0]!)

    expect(engineMenuFacts(engine, AWAKE, 'darwin')).toMatchObject({
      company: 'Acme',
      employees: 2,
      running: 1,
      paused: false,
    })
  })

  it('says the Company is paused, as the office header does', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    hire(engine, ['Ada'], provider)
    engine.sessions.stopAll()

    expect(engineMenuFacts(engine, AWAKE, 'darwin')).toMatchObject({ paused: true, running: 0 })
  })

  it('offers every Company the boss can go back to, the one in use first', () => {
    const { engine } = newEngine()
    const acme = engine.createCompany({ folder: folder(), name: 'Acme' })
    const globex = engine.createCompany({ folder: folder(), name: 'Globex' })

    expect(engineMenuRecents(engine)).toEqual([
      { id: globex.id, name: 'Globex', current: true, missing: false },
      { id: acme.id, name: 'Acme', current: false, missing: false },
    ])
  })
})

describe('the menu over a live engine', () => {
  it('greys the team and the views until a Company is open, then means them', () => {
    const { engine } = newEngine()
    const menu = run(engine)

    expect(menu.find('Hire Employee…', 'Team')?.enabled).toBe(false)
    expect(menu.find('Office', 'Go')?.enabled).toBe(false)

    engine.createCompany({ folder: folder(), name: 'Acme' })

    expect(menu.find('Hire Employee…', 'Team')?.enabled).toBe(true)
    expect(menu.find('Office', 'Go')?.enabled).toBe(true)
    expect(menu.find('Acme', 'File')).toBeUndefined()
    expect((menu.find('Open Recent', 'File')?.submenu ?? []).map((item) => item.label)).toEqual(['Acme'])
  })

  it('reads again on its own the moment an Employee is hired', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const menu = run(engine)

    expect(menu.find('Start every Session', 'Team')?.enabled).toBe(false)
    hire(engine, ['Ada'], provider, false)

    expect(menu.find('Start every Session', 'Team')?.enabled).toBe(true)
    expect(menu.find('Stop every Session', 'Team')?.enabled).toBe(false)
  })

  it('follows a Session starting and stopping', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const menu = run(engine)
    const ids = hire(engine, ['Ada'], provider)

    expect(menu.find('Pause all', 'Team')?.enabled).toBe(true)
    expect(menu.find('Stop every Session', 'Team')?.enabled).toBe(true)

    engine.sessions.stop(ids[0]!)

    expect(menu.find('Pause all', 'Team')?.enabled).toBe(false)
  })

  it('reads Resume all the moment everything is paused', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const menu = run(engine)
    hire(engine, ['Ada'], provider)

    engine.sessions.stopAll()

    expect(menu.find('Resume all', 'Team')).toBeDefined()
    expect(menu.find('Pause all', 'Team')).toBeUndefined()
  })

  it('ticks the awake mode it is told, and redraws when the boss switches it', () => {
    const { engine } = newEngine()
    let awake: KeepAwakeState = { mode: 'off', holding: false, supported: true }
    const menu = run(engine, () => awake)
    const modes = () =>
      (menu.submenu('TinyCorp').find((item) => item.label === 'Keep this Mac awake')?.submenu ?? []).filter(
        (item) => item.checked,
      )

    expect(modes().map((item) => item.label)).toEqual(['Off'])
    awake = { mode: 'on', holding: true, supported: true }
    menu.menu.refresh()

    expect(modes().map((item) => item.label)).toEqual(['On'])
  })

  it('never opens a Company folder to answer a Session change', () => {
    const { engine, provider } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const menu = run(engine)
    const readsAfterFirstDraw = menu.reads.recents

    const ids = hire(engine, ['Ada'], provider)
    engine.sessions.stop(ids[0]!)

    // Only the Company set is worth reading folders for; a Session status is not.
    expect(menu.reads.recents).toBe(readsAfterFirstDraw)
    expect(menu.drawn.length).toBeGreaterThan(1)
  })

  it('reads the Companies again when one is opened', () => {
    const { engine } = newEngine()
    const menu = run(engine)
    const before = menu.reads.recents

    engine.createCompany({ folder: folder(), name: 'Globex' })

    expect(menu.reads.recents).toBe(before + 1)
  })

  it('lets go of the engine when it is closed', () => {
    const { engine } = newEngine()
    engine.createCompany({ folder: folder(), name: 'Acme' })
    const menu = run(engine)
    const drawn = menu.drawn.length

    menu.menu.close()
    engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(menu.drawn.length).toBe(drawn)
  })
})
