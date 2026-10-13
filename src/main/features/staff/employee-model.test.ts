import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDERS, type Provider } from '../../../shared/domain/providers'
import { modelLabel, PROVIDER_MODELS, providerForModel } from '../../../shared/staff/models'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrate } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
  return { engine, provider, pam }
}

describe('Employee model', () => {
  it('defaults to the provider’s default', () => {
    const { engine, pam } = setup()

    expect(pam.model).toBeNull()
    expect(engine.employees.list()[0]!.model).toBeNull()
  })

  it('is chosen at hire from the provider’s models and kept', () => {
    const { engine } = setup()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', model: 'opus-5-balanced' })

    expect(ada.model).toBe('opus-5-balanced')
    expect(engine.employees.list().find((e) => e.id === ada.id)!.model).toBe('opus-5-balanced')
  })

  it('refuses a model the provider does not know', () => {
    const { engine } = setup()

    expect(() => engine.employees.create({ name: 'Ada', roleId: 'backend', model: 'gpt-9' })).toThrow(/unknown model/i)
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam'])
  })

  it('is editable on the Employee, and back to the default', () => {
    const { engine, pam } = setup()

    expect(engine.employees.update(pam.id, { model: 'sonnet-5-fast' }).model).toBe('sonnet-5-fast')
    expect(engine.employees.list()[0]!.model).toBe('sonnet-5-fast')
    expect(engine.employees.update(pam.id, { model: null }).model).toBeNull()
    expect(() => engine.employees.update(pam.id, { model: 'nope' })).toThrow(/unknown model/i)
  })

  it('reaches the provider adapter when the Session spawns', () => {
    const { engine, provider, pam } = setup()
    engine.employees.update(pam.id, { model: 'opus-5-deep' })

    engine.sessions.start(pam.id)

    expect(provider.spawnOf(pam.id).request.employee.model).toBe('opus-5-deep')
    expect(provider.spawnOf(pam.id).modelArgs).toEqual(['--model', 'claude-opus-5', '--effort', 'high'])
  })

  it('spawns with no model args on the default', () => {
    const { engine, provider, pam } = setup()

    engine.sessions.start(pam.id)

    expect(provider.spawnOf(pam.id).modelArgs).toEqual([])
  })

  it('labels a model with its own name, and says the effort the CLI is handed beside it', () => {
    // The label is the model; `fast` / `balanced` / `deep` were ours and the CLI never saw them.
    expect(PROVIDER_MODELS.claude.map((m) => m.label)).toContain('Opus 5')
    expect(modelLabel('claude', 'opus-5-balanced')).toBe('Opus 5 · medium')
    expect(modelLabel('claude', 'haiku-4-5-fast')).toBe('Haiku 4.5')
  })
})

describe('Hire proposal model', () => {
  it('carries the proposed model to the hire once approved', () => {
    const { engine, provider, pam } = setup()

    const outcome = engine.hiring.requestHire({
      requesterId: pam.id,
      role: 'Frontend',
      reason: 'Two UI tickets',
      name: 'Lyra',
      model: 'sonnet-5-balanced',
    })

    if (outcome.status !== 'pending') throw new Error('expected pending')
    expect(outcome.request.model).toBe('sonnet-5-balanced')
    engine.approvals.decide(outcome.approvalId, { approve: true })
    const lyra = engine.employees.list().find((e) => e.name === 'Lyra')!
    expect(lyra.model).toBe('sonnet-5-balanced')
    expect(provider.spawnOf(lyra.id).modelArgs).toEqual(['--model', 'claude-sonnet-5', '--effort', 'medium'])
  })

  it('refuses an unknown proposed model without filing anything', () => {
    const { engine, pam } = setup()

    expect(() =>
      engine.hiring.requestHire({ requesterId: pam.id, role: 'Frontend', reason: 'UI', model: 'gpt-9' }),
    ).toThrow(/unknown model/i)
    expect(engine.hiring.requests()).toEqual([])
    expect(engine.approvals.list()).toEqual([])
  })

  it('lets the boss change the model of a pending proposal before approving', () => {
    const { engine, pam } = setup()
    const outcome = engine.hiring.requestHire({ requesterId: pam.id, role: 'Frontend', reason: 'UI', name: 'Lyra' })
    if (outcome.status !== 'pending') throw new Error('expected pending')
    expect(outcome.request.model).toBeNull()

    const edited = engine.hiring.setRequestModel(outcome.request.id, 'opus-5-balanced')

    expect(edited.model).toBe('opus-5-balanced')
    expect(engine.hiring.requests()[0]!.model).toBe('opus-5-balanced')
    engine.approvals.decide(outcome.approvalId, { approve: true })
    expect(engine.employees.list().find((e) => e.name === 'Lyra')!.model).toBe('opus-5-balanced')
  })

  it('does not change a decided proposal', () => {
    const { engine, pam } = setup()
    const outcome = engine.hiring.requestHire({ requesterId: pam.id, role: 'Frontend', reason: 'UI' })
    if (outcome.status !== 'pending') throw new Error('expected pending')
    engine.approvals.decide(outcome.approvalId, { approve: false, reason: 'Not now' })

    expect(() => engine.hiring.setRequestModel(outcome.request.id, 'opus-5-balanced')).toThrow(/pending/i)
    expect(() => engine.hiring.setRequestModel(9999, null)).toThrow(/unknown/i)
  })

  it('applies a proposed model to a rehire', () => {
    const { engine, pam } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.hiring.fire(ada.id)
    engine.approvals.setLevel('autonomous')

    const outcome = engine.hiring.requestHire({
      requesterId: pam.id,
      role: 'Backend',
      reason: 'API work',
      name: 'Ada',
      model: 'haiku-4-5-fast',
    })

    expect(outcome.status).toBe('done')
    expect(engine.employees.list().find((e) => e.id === ada.id)!.model).toBe('haiku-4-5-fast')
  })
})

describe('A model belongs to one Provider’s catalogue', () => {
  it('gives every Provider its own models, and no two the same ids', () => {
    const ids = Object.values(PROVIDER_MODELS).flatMap((options) => options.map((o) => o.id))

    expect(Object.keys(PROVIDER_MODELS).sort()).toEqual([...PROVIDERS].sort())
    expect(new Set(ids).size).toBe(ids.length)
    for (const [provider, options] of Object.entries(PROVIDER_MODELS)) {
      expect(options.length).toBeGreaterThan(0)
      for (const option of options) expect(providerForModel(option.id)).toBe(provider as Provider)
    }
  })

  it('names no Provider for the default, nor for a model the catalogue has lost', () => {
    expect(providerForModel(null)).toBeNull()
    expect(providerForModel('a-model-tinycorp-removed')).toBeNull()
  })

  /**
   * The bug T139 took out: Provider and model were two choices, and moving one silently rewrote
   * the other. There is one choice now — the model — and the Provider follows it.
   */
  it('writes the Provider from the model, at hire and at every edit', () => {
    const { engine } = setup()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', model: 'gpt-6-astra-deep' })
    expect(ada.provider).toBe('codex')

    const moved = engine.employees.update(ada.id, { model: 'opus-5-deep' })
    expect(moved.provider).toBe('claude')
    expect(moved.model).toBe('opus-5-deep')
    expect(engine.employees.list().find((e) => e.id === ada.id)).toMatchObject({
      provider: 'claude',
      model: 'opus-5-deep',
    })
  })

  it('keeps the Provider an Employee with no model runs on', () => {
    const { engine } = setup()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', provider: 'codex' })
    expect(ada).toMatchObject({ provider: 'codex', model: null })

    const cleared = engine.employees.update(ada.id, { model: null })
    expect(cleared).toMatchObject({ provider: 'codex', model: null })
  })

  it('refuses a model and a Provider that do not go together, rather than rewriting either', () => {
    const { engine } = setup()

    expect(() =>
      engine.employees.create({ name: 'Ada', roleId: 'backend', provider: 'codex', model: 'opus-5-deep' }),
    ).toThrow(/unknown model/i)
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam'])
  })
})

describe('Employee model migration', () => {
  it('adds a nullable model to existing Employees and proposals', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)

    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]).find(
        (c) => c.name === 'model',
      )
    expect(columns('employee')).toMatchObject({ notnull: 0 })
    expect(columns('staffing_request')).toMatchObject({ notnull: 0 })
  })
})
