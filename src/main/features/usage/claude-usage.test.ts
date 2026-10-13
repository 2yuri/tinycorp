import { sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const NOW = new Date('2026-09-17T12:00:00.000Z')
const engines: CompanyEngine[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
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
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

/** Opens a Company with `names` hired, leaving it current. */
function company(engine: CompanyEngine, name: string, names: string[]) {
  const created = engine.createCompany({ folder: `${onDisk('/work')}${sep}${name.toLowerCase()}`, name })
  const team = names.map((who) => engine.employees.create({ name: who, roleId: 'backend' }))
  return { company: created, team }
}

describe('Claude usage across the open Companies', () => {
  it('reports each open Company’s Sessions against its own cap, current or not', () => {
    const { engine } = setup()
    const acme = company(engine, 'Acme', ['Ada', 'Grace'])
    for (const employee of acme.team) engine.sessions.start(employee.id)
    const zeta = company(engine, 'Zeta', ['Juno'])
    engine.sessions.start(zeta.team[0]!.id)
    engine.capacity.setConcurrencyCap(3)

    expect(engine.capacity.usage()).toEqual({
      budget: null,
      companies: [
        { companyId: acme.company.id, companyName: 'Acme', concurrencyCap: 5, running: 2, parked: [] },
        { companyId: zeta.company.id, companyName: 'Zeta', concurrencyCap: 3, running: 1, parked: [] },
      ],
    })
    // The current Company alone sees only its own numbers.
    expect(engine.capacity.get()).toMatchObject({ concurrencyCap: 3, running: 1 })
  })

  it('names the Employees waiting for a slot, longest-waiting first', () => {
    const { engine } = setup()
    const acme = company(engine, 'Acme', ['Ada', 'Grace', 'Juno'])
    engine.capacity.setConcurrencyCap(1)
    for (const employee of acme.team) engine.sessions.start(employee.id)

    expect(engine.capacity.usage().companies).toEqual([
      { companyId: acme.company.id, companyName: 'Acme', concurrencyCap: 1, running: 1, parked: ['Grace', 'Juno'] },
    ])
  })

  it('carries the app-wide budget, which is one per boss and not per Company', () => {
    const { engine, provider } = setup()
    const acme = company(engine, 'Acme', ['Ada'])
    engine.sessions.start(acme.team[0]!.id)
    const session = provider.spawnOf(acme.team[0]!.id)
    session.hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)

    session.pty.output('Claude usage limit reached. Your limit will reset at 3pm (UTC)')

    expect(engine.capacity.usage().budget).toEqual({
      exhaustedAt: new Date().toISOString(),
      resetsAt: new Date('2026-09-17T15:00:00.000Z').toISOString(),
    })
  })

  it('drops a Company the boss removed from the launcher', () => {
    const { engine } = setup()
    const acme = company(engine, 'Acme', ['Ada'])
    company(engine, 'Zeta', ['Juno'])

    engine.forgetCompany(acme.company.id)

    expect(engine.capacity.usage().companies.map((c) => c.companyName)).toEqual(['Zeta'])
  })
})
