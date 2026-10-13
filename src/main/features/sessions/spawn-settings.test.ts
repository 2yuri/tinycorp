import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionStatus } from '../../../shared/session'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

/**
 * The three settings a Session bakes in at its spawn, and what `Apply now` does about them (T237).
 *
 * The bug this would have caught is the one the ticket was written for: the boss changes how
 * Employees talk, every screen says it is saved, and eight Sessions go on writing the other voice
 * until somebody notices days later. Everything here is asked of the whole engine, because the
 * question — *is this Employee still running what it was told?* — is only true across the Sessions,
 * the settings and the instructions at once.
 */

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup(): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, provider }
}

/** An Employee with a Session at its prompt, which is the only state `Apply now` restarts. */
function working(engine: CompanyEngine, provider: FakeProvider, name: string): { id: string } {
  const employee = engine.employees.create({ name, roleId: 'backend' })
  engine.sessions.start(employee.id)
  provider.spawnOf(employee.id).hook('SessionStart')
  vi.advanceTimersByTime(2000)
  return employee
}

/** A Session mid-turn: `Apply now` leaves it alone until it says it is done. */
function busy(provider: FakeProvider, employeeId: string): void {
  provider.spawnOf(employeeId).hook('UserPromptSubmit')
}

describe('settings a Session bakes in at its spawn', () => {
  it('says nobody is behind while every Session carries what the Company says now', () => {
    const { engine, provider } = setup()
    working(engine, provider, 'Ada')

    expect(engine.spawnSettings.stale()).toEqual([])
  })

  it('names the Employee still on the old voice, and stops naming it once it restarts', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')

    engine.voice.setColleague('plain')
    const behind = engine.spawnSettings.stale()
    engine.spawnSettings.applyNow()

    expect(behind).toEqual([{ employeeId: ada.id, name: 'Ada', busy: false, settings: ['colleagueVoice'] }])
    expect(engine.spawnSettings.stale()).toEqual([])
  })

  it('names the notes budget and Lean builder the same way, and only the one that changed', () => {
    const { engine, provider } = setup()
    working(engine, provider, 'Ada')

    engine.notes.setBudget(8000)
    const afterBudget = engine.spawnSettings.stale().map((one) => one.settings)
    engine.buildStyle.set('lean')

    expect(afterBudget).toEqual([['notesBudget']])
    expect(engine.spawnSettings.stale().map((one) => one.settings)).toEqual([['notesBudget', 'buildStyle']])
  })

  it('restarts an idle Session in its own seat, resuming it with instructions written again', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    const first = provider.spawnOf(ada.id)
    const seen: SessionStatus[] = []
    engine.sessions.onChange(() => seen.push(engine.sessions.get(ada.id).status))

    engine.voice.setColleague('plain')
    const applied = engine.spawnSettings.applyNow()

    const second = provider.spawnOf(ada.id)
    expect(applied).toEqual({ restarted: [ada.id], waiting: [] })
    // The same conversation, so the same id and `--resume`; the instructions are the new ones.
    expect(second.request).toMatchObject({ sessionId: first.request.sessionId, resume: true })
    expect(second.instructions?.text).not.toBe(first.instructions?.text)
    expect(first.pty.killed).toBe(true)
    // Never through `off`: a Session that passed through it would give its seat to a parked
    // Employee and come back at the end of the queue.
    expect(seen).not.toContain('off')
    expect(seen.at(-1)).toBe('starting')
  })

  it('leaves a Session mid-turn alone, and restarts it the moment its turn ends', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    busy(provider, ada.id)

    engine.voice.setColleague('plain')
    const applied = engine.spawnSettings.applyNow()
    const duringTurn = { spawns: provider.spawns.length, stale: engine.spawnSettings.stale() }
    provider.spawnOf(ada.id).hook('Stop')

    expect(applied).toEqual({ restarted: [], waiting: [ada.id] })
    expect(duringTurn.stale).toEqual([{ employeeId: ada.id, name: 'Ada', busy: true, settings: ['colleagueVoice'] }])
    expect(duringTurn.spawns).toBe(1)
    expect(provider.spawns).toHaveLength(2)
    expect(engine.spawnSettings.stale()).toEqual([])
  })

  it('restarts the idle half of the floor and waits for the busy half', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    const iris = working(engine, provider, 'Iris')
    busy(provider, iris.id)

    engine.buildStyle.set('lean')
    const applied = engine.spawnSettings.applyNow()

    expect(applied).toEqual({ restarted: [ada.id], waiting: [iris.id] })
  })

  it('owes a stopped Session nothing: the next one it starts is spawned from the settings as they are', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    busy(provider, ada.id)
    engine.buildStyle.set('lean')
    engine.spawnSettings.applyNow()

    engine.sessions.stop(ada.id)
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart')
    vi.advanceTimersByTime(2000)

    expect(provider.spawns).toHaveLength(2)
    expect(engine.spawnSettings.stale()).toEqual([])
  })
})

/**
 * What saving an Employee does to the Session it is running (T268). The bug: the boss hands the
 * Designer an MCP server, the modal says *Saved*, and the Designer goes on without the tools for as
 * long as its Session lives — and a restart brought back the record it had started with.
 */
describe('an Employee the boss saves', () => {
  it('restarts its idle Session where it stands, spawned from what was saved', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    const first = provider.spawnOf(ada.id)

    engine.employees.update(ada.id, { persona: 'You design with Pen first, and report what you drew.' })

    const second = provider.spawnOf(ada.id)
    expect(provider.spawns).toHaveLength(2)
    // The same conversation, so the same id and `--resume`; the persona is the one just saved.
    expect(second.request).toMatchObject({ sessionId: first.request.sessionId, resume: true })
    expect(second.request.employee.persona).toBe('You design with Pen first, and report what you drew.')
    expect(second.instructions?.text).toContain('You design with Pen first, and report what you drew.')
    expect(first.pty.killed).toBe(true)
  })

  it('leaves a Session mid-turn alone, and restarts it from the saved record the moment its turn ends', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    busy(provider, ada.id)

    engine.employees.update(ada.id, { model: 'sonnet-5-balanced' })
    const duringTurn = provider.spawns.length
    provider.spawnOf(ada.id).hook('Stop')

    expect(duringTurn).toBe(1)
    expect(provider.spawns).toHaveLength(2)
    expect(provider.spawnOf(ada.id).request.employee.model).toBe('sonnet-5-balanced')
  })

  it('restarts nobody for what a Session never reads, nor anyone whose record did not change', () => {
    const { engine, provider } = setup()
    const ada = working(engine, provider, 'Ada')
    working(engine, provider, 'Iris')

    engine.employees.update(ada.id, { sprite: 7 })

    expect(provider.spawns).toHaveLength(2)
    expect(engine.spawnSettings.applyEdits()).toEqual({ restarted: [], waiting: [] })
  })
})
