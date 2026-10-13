import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { officeLayout } from '../../../shared/office/layout'
import { projectOffice } from '../../../shared/office/projection'
import { ROOM_SLUGS, roomGeometry } from '../../../shared/office/rooms'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-17T12:00:00.000Z') })
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** An engine on in-memory state, for everything that does not outlive the process. */
function start() {
  const provider: FakeProvider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

function setup() {
  const { engine, provider } = start()
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

  /** The office as the renderer projects it now. */
  const office = () => projectOffice({ employees: engine.employees.list(), ...engine.office.facts(), now: Date.now() })

  return { engine, provider, ada, office }
}

/** An engine on a real Company folder, so a second one can reopen it as a restart would. */
function launch() {
  const provider: FakeProvider = fakeProvider()
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

describe('the Company office room', () => {
  it('starts in Night Studio, the room the office was built on', () => {
    const { engine, office } = setup()

    expect(engine.office.room()).toBe('night-studio')
    expect(engine.office.facts().room).toBe('night-studio')
    expect(office().room).toBe('night-studio')
  })

  it('moves the Company into a room somebody has measured', () => {
    const { engine, office } = setup()

    engine.office.setRoom('warm-loft')

    expect(engine.office.room()).toBe('warm-loft')
    expect(office().room).toBe('warm-loft')
    expect(office().layout.painting).toEqual({ width: 1040, height: 660 })
  })

  it('takes every room of the picker, now that all six are measured (T91)', () => {
    const { engine } = setup()

    for (const slug of ROOM_SLUGS) {
      engine.office.setRoom(slug)

      expect(engine.office.room()).toBe(slug)
    }
  })

  it('refuses a room nobody has drawn', () => {
    const { engine } = setup()

    expect(() => engine.office.setRoom('the-moon')).toThrow(/unknown room/i)
    expect(engine.office.room()).toBe('night-studio')
  })

  it('keeps the choice across a restart', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-room-'))
    folders.push(folder)
    const first = launch().engine
    first.createCompany({ folder, name: 'Acme' })
    first.office.setRoom('night-studio')
    engines.splice(engines.indexOf(first), 1)
    first.close()

    const reopened = launch().engine
    reopened.openCompany(folder)

    expect(reopened.office.room()).toBe('night-studio')
    expect(reopened.office.facts().room).toBe('night-studio')
  })

  it('tells the office something changed when the room is picked', () => {
    const { engine } = setup()
    let changes = 0
    engine.office.onChange(() => changes++)

    engine.office.setRoom('night-studio')

    expect(changes).toBeGreaterThan(0)
  })

  it('leaves running Sessions alone and keeps every Employee at their own desk number', () => {
    const { engine, provider, ada, office } = setup()
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    const before = office().sprites.find((s) => s.employeeId === ada.id)!

    engine.office.setRoom('night-studio')
    const after = office().sprites.find((s) => s.employeeId === ada.id)!

    expect(engine.sessions.list().find((s) => s.employeeId === ada.id)?.status).toBe(
      before.state === 'off' ? 'off' : 'idle',
    )
    expect(provider.spawnOf(ada.id).pty.killed).toBe(false)
    // The desk index is the Employee's; the room only decides where desk `i` stands.
    expect(after.seat!.uid).toBe(`desk-${engine.employees.list().find((e) => e.id === ada.id)!.desk}`)
    expect(after.seat!.uid).toBe(before.seat!.uid)
  })
})

describe('the projected office', () => {
  it('builds the room the Company chose', () => {
    const { engine } = setup()
    const employees = engine.employees.list()

    const scene = projectOffice({ employees, room: 'night-studio' })

    expect(scene.room).toBe('night-studio')
    expect(scene.layout.seats.length).toBe(officeLayout(roomGeometry('night-studio')).seats.length)
    expect(scene.layout.painting).toEqual({
      width: roomGeometry('night-studio').width,
      height: roomGeometry('night-studio').height,
    })
  })

  it('falls back to the default room for one this build cannot draw', () => {
    const { engine } = setup()

    const scene = projectOffice({ employees: engine.employees.list(), room: 'warm-loft' })

    expect(scene.layout.painting).toEqual({
      width: roomGeometry('night-studio').width,
      height: roomGeometry('night-studio').height,
    })
  })
})
