import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_FILE } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from './sessions'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

const notesFiles = inMemoryNotesFiles()

/** One run of the app over a real Company folder, so quitting and reopening is real. */
function launch(): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: provider },
    notesFiles,
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

function quit(engine: CompanyEngine): void {
  engines.splice(engines.indexOf(engine), 1)
  engine.close()
}

/** A Company whose Employees all run a Session that got ready. */
function running(names: string[]) {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-pause-'))
  folders.push(folder)
  const { engine, provider } = launch()
  engine.createCompany({ folder, name: 'Acme' })
  const team = names.map((name) => engine.employees.create({ name, roleId: 'backend' }))
  for (const employee of team) {
    engine.sessions.start(employee.id)
    provider.spawnOf(employee.id).hook('SessionStart', { source: 'startup' })
  }
  vi.advanceTimersByTime(READY_DELAY_MS)
  return { folder, engine, provider, team, ids: team.map((e) => e.id) }
}

const statuses = (engine: CompanyEngine) => engine.sessions.list().map((s) => s.status)

/**
 * Writes the Company's own tables from outside the engine, which is the only way to build the state
 * a build that is no longer here left behind (T217): a `company_pause` row with no `paused_session`
 * behind it. A second connection on the same file, so the open engine reads what this wrote.
 */
function asAnOlderBuild(folder: string, edit: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(join(folder, COMPANY_FILE))
  try {
    edit(db)
  } finally {
    db.close()
  }
}

describe('Pause all', () => {
  it('stops every Session: Employees are off and no slot is used', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])

    engine.sessions.stopAll()

    expect(engine.sessions.paused()).toBe(true)
    expect(statuses(engine)).toEqual(['off', 'off'])
    expect(ids.map((id) => provider.spawnOf(id).pty.killed)).toEqual([true, true])
    expect(engine.capacity.get()).toMatchObject({ running: 0, concurrencyCap: 5, parked: [] })
  })

  it('also takes parked Employees out of the queue, without starting them in a freed slot', () => {
    const { engine, provider, ids } = running(['Ada'])
    engine.capacity.setConcurrencyCap(1)
    const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })
    engine.sessions.start(grace.id)
    expect(engine.sessions.get(grace.id).status).toBe('parked')

    engine.sessions.stopAll()

    expect(statuses(engine)).toEqual(['off', 'off'])
    expect(provider.spawns.map((s) => s.request.employee.id)).toEqual(ids)
    expect(engine.capacity.get()).toMatchObject({ running: 0, parked: [] })
  })

  /*
   * T217. `Pause all` held whoever was running *right then*, so a Company whose Sessions had died —
   * or had not come back yet after a reopen — was paused holding nobody, and `Resume all` then had
   * nothing to bring back. The Employee below is still owed a Session: only the boss's own Stop
   * says otherwise.
   */
  it('holds the Sessions a reopen still owes, not only the ones running right now', () => {
    const { engine, provider, ids } = running(['Ada'])
    provider.spawnOf(ids[0]!).pty.exit(1)
    expect(statuses(engine)).toEqual(['off'])

    engine.sessions.stopAll()

    expect(engine.sessions.startAll()).toMatchObject({ resumed: ids, failed: [], from: 'held' })
    expect(provider.spawns.slice(1).map((s) => s.request.employee.id)).toEqual(ids)
  })

  it('refuses to start a Session while paused', () => {
    const { engine, ids } = running(['Ada'])
    engine.sessions.stopAll()

    expect(() => engine.sessions.start(ids[0]!)).toThrow('Acme is paused: Resume all to start Sessions')
    expect(statuses(engine)).toEqual(['off'])
  })

  it('tells listeners, so the office header can flip to Resume all', () => {
    const { engine } = running(['Ada'])
    const changed = vi.fn()
    engine.sessions.onChange(changed)

    engine.sessions.stopAll()
    expect(changed).toHaveBeenCalled()
    changed.mockClear()
    engine.sessions.startAll()
    expect(changed).toHaveBeenCalled()
  })

  it('keeps the Company paused across a restart: nothing comes back on open', () => {
    const { folder, engine } = running(['Ada', 'Grace'])
    engine.sessions.stopAll()
    quit(engine)

    const second = launch()
    second.engine.openCompany(folder)

    expect(second.engine.sessions.paused()).toBe(true)
    expect(second.provider.spawns).toEqual([])
    expect(statuses(second.engine)).toEqual(['off', 'off'])
  })

  it('is per Company: another open Company is not paused', () => {
    const { engine } = running(['Ada'])
    engine.sessions.stopAll()
    const other = mkdtempSync(join(tmpdir(), 'tinycorp-pause-'))
    folders.push(other)

    engine.createCompany({ folder: other, name: 'Globex' })

    expect(engine.sessions.paused()).toBe(false)
  })
})

describe('Resume all', () => {
  it('starts the paused Sessions again, continuing their last conversation', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    const sessionIds = ids.map((id) => engine.sessions.get(id).providerSessionId)
    engine.sessions.stopAll()

    engine.sessions.startAll()

    expect(engine.sessions.paused()).toBe(false)
    expect(
      provider.spawns.slice(2).map(({ request }) => [request.employee.id, request.sessionId, request.resume]),
    ).toEqual([
      [ids[0], sessionIds[0], true],
      [ids[1], sessionIds[1], true],
    ])
    expect(statuses(engine)).toEqual(['starting', 'starting'])
  })

  it('honours the concurrency cap: the rest park and resume when a slot frees', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    const graceSession = engine.sessions.get(ids[1]!).providerSessionId
    engine.sessions.stopAll()
    engine.capacity.setConcurrencyCap(1)

    engine.sessions.startAll()

    expect(statuses(engine)).toEqual(['starting', 'parked'])
    expect(engine.capacity.get()).toMatchObject({ running: 1, concurrencyCap: 1, parked: [ids[1]] })

    engine.sessions.stop(ids[0]!)

    expect(provider.spawnOf(ids[1]!).request).toMatchObject({ sessionId: graceSession, resume: true })
    expect(statuses(engine)).toEqual(['off', 'starting'])
  })

  it('does not start Employees that were off when the Company was paused', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    engine.sessions.stop(ids[1]!)
    engine.sessions.stopAll()

    engine.sessions.startAll()

    expect(provider.spawns.slice(2).map((s) => s.request.employee.id)).toEqual([ids[0]])
    expect(statuses(engine)).toEqual(['starting', 'off'])
  })

  it('does not start an Employee the boss stopped after the pause', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    engine.sessions.stopAll()
    engine.sessions.stop(ids[0]!)

    engine.sessions.startAll()

    expect(provider.spawns.slice(2).map((s) => s.request.employee.id)).toEqual([ids[1]])
  })

  it('works after a restart, and the resumed Sessions come back on the next open', () => {
    const { folder, engine, ids } = running(['Ada'])
    engine.sessions.stopAll()
    quit(engine)
    const second = launch()
    second.engine.openCompany(folder)

    second.engine.sessions.startAll()
    expect(second.provider.spawnOf(ids[0]!).request.resume).toBe(true)
    quit(second.engine)

    const third = launch()
    third.engine.openCompany(folder)
    expect(third.engine.sessions.paused()).toBe(false)
    expect(third.provider.spawns.map((s) => s.request.employee.id)).toEqual(ids)
  })

  /*
   * T217, the boss's own report: `Resume all does nothing`. Nobody was running when the Company was
   * paused, so nothing was held; the pause was lifted, nobody started, and the only trace was a line
   * in the log the boss never sees. The button now answers what it came to.
   */
  it('says so when the pause held nobody, instead of silently starting nothing', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    for (const id of ids) engine.sessions.stop(id)
    engine.sessions.stopAll()
    const spawns = provider.spawns.length

    const outcome = engine.sessions.startAll()

    expect(outcome).toEqual({ paused: false, resumed: [], failed: [], from: 'nobody' })
    expect(provider.spawns).toHaveLength(spawns)
    // The pause is lifted either way, or the boss could not start anyone at all.
    expect(engine.sessions.paused()).toBe(false)
  })

  it('resumes what a reopen still owed when a pause row survived without its holds', () => {
    const { folder, engine, provider, ids } = running(['Ada', 'Grace'])
    engine.sessions.stopAll()
    asAnOlderBuild(folder, (db) => {
      db.exec('DELETE FROM paused_session')
      for (const id of ids) db.prepare('INSERT INTO session_restore (employee_id) VALUES (?)').run(id)
    })

    const outcome = engine.sessions.startAll()

    expect(outcome).toMatchObject({ paused: false, resumed: ids, failed: [], from: 'restoring' })
    expect(provider.spawns.slice(2).map(({ request }) => [request.employee.id, request.resume])).toEqual([
      [ids[0], true],
      [ids[1], true],
    ])
  })

  it('says so when a pause row survived with nothing behind it at all', () => {
    const { folder, engine } = running(['Ada'])
    engine.sessions.stopAll()
    asAnOlderBuild(folder, (db) => db.exec('DELETE FROM paused_session'))

    expect(engine.sessions.startAll()).toEqual({ paused: false, resumed: [], failed: [], from: 'nobody' })
  })

  it('reopens paused after a restart even when a pause row survived without its holds', () => {
    const { folder, engine, ids } = running(['Ada'])
    engine.sessions.stopAll()
    asAnOlderBuild(folder, (db) => {
      db.exec('DELETE FROM paused_session')
      for (const id of ids) db.prepare('INSERT INTO session_restore (employee_id) VALUES (?)').run(id)
    })
    quit(engine)

    const second = launch()
    second.engine.openCompany(folder)

    // The reopen owes these Sessions, and the pause is what says they may not start yet.
    expect(second.engine.sessions.paused()).toBe(true)
    expect(second.provider.spawns).toEqual([])
    expect(second.engine.sessions.startAll()).toMatchObject({ resumed: ids, from: 'restoring' })
    expect(second.provider.spawns.map((s) => s.request.employee.id)).toEqual(ids)
  })

  /* T217: a resume that could not start an Employee logged it and told the boss nothing. */
  it('names every Employee it could not bring back', () => {
    const { engine, provider, ids, team } = running(['Ada', 'Grace'])
    engine.sessions.stopAll()
    provider.uninstall()

    const outcome = engine.sessions.startAll()

    expect(outcome.resumed).toEqual([])
    expect(outcome.failed).toEqual([
      { employeeId: ids[0], name: team[0]!.name, reason: expect.any(String) },
      { employeeId: ids[1], name: team[1]!.name, reason: expect.any(String) },
    ])
    expect(outcome.from).toBe('held')
    expect(engine.sessions.paused()).toBe(false)
  })

  it('answers with the Sessions it started, so the header can flip to Pause all', () => {
    const { engine, ids } = running(['Ada', 'Grace'])
    engine.sessions.stopAll()

    expect(engine.sessions.startAll()).toEqual({
      paused: false,
      resumed: ids,
      failed: [],
      from: 'held',
    })
  })

  it('starts an Employee rehired while paused', () => {
    const { engine, provider, ids } = running(['Ada', 'Grace'])
    engine.hiring.fire(ids[1]!)
    engine.sessions.stopAll()

    engine.hiring.rehire(ids[1]!)
    expect(provider.spawns).toHaveLength(2)
    expect(engine.sessions.get(ids[1]!).status).toBe('off')

    engine.sessions.startAll()
    expect(provider.spawns.slice(2).map((s) => s.request.employee.id)).toEqual(ids)
  })
})

describe('Quitting the app', () => {
  it('is not a pause: running Sessions come back on the next open', () => {
    const { folder, engine, ids } = running(['Ada'])
    quit(engine)

    const second = launch()
    second.engine.openCompany(folder)

    expect(second.engine.sessions.paused()).toBe(false)
    expect(second.provider.spawns.map((s) => s.request.employee.id)).toEqual(ids)
  })
})
