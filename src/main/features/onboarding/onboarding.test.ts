import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { OnboardingDraft } from '../../../shared/onboarding'
import { rosterFromPreset, rosterHires } from '../../../shared/staff/roster-draft'
import { teamPreset } from '../../../shared/staff/team-presets'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrations } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const provider = fakeProvider()
  const logged: string[] = []
  const openDatabase = inMemoryDatabases()
  const engine = createCompanyEngine({
    openDatabase,
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    log: (line) => logged.push(line),
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const company = engine.createCompany({ folder: onDisk('/work/tiny'), name: 'Tiny Corp' })
  /** The Company's own database, for the tests that put something in it the engine would not. */
  const database = () => openDatabase(company.folder, 'existing')!
  return { engine, provider, company, logged, database }
}

/** The Product squad roster as the Your team step hands it over: Hera (PM), Orion, Ada and Vega. */
const squad = () => rosterHires(rosterFromPreset(teamPreset('product-squad'), 'claude'))
const byName = (engine: CompanyEngine, name: string) => engine.employees.list().find((e) => e.name === name)!
const status = (engine: CompanyEngine, name: string) => engine.sessions.get(byName(engine, name).id).status
const dmOf = (engine: CompanyEngine, name: string) =>
  engine.chat().read({ channelId: dmChannelId(BOSS, byName(engine, name).id) })

describe('Setup wizard Finish', () => {
  it('starts unfinished for a Company just created', () => {
    const { engine, company } = setup()

    expect(engine.onboarding.completedAt()).toBeNull()
    expect(engine.companySummaries().find((c) => c.id === company.id)?.onboardingCompletedAt).toBeNull()
  })

  it('creates only the roles the roster hires, not all eight built-ins (T240)', () => {
    const { engine } = setup()

    expect(engine.roles.list()).toEqual([])
    engine.onboarding.finish({ hires: squad(), goal: null })

    expect(engine.roles.list().map((r) => r.id)).toEqual(['pm', 'tech-lead', 'frontend', 'backend'])
    expect(engine.roles.list().every((r) => r.seeded)).toBe(true)
    expect(engine.roles.removeUnused()).toEqual([])
  })

  it('takes the roster’s roles as the draft is saved, so the Repositories step has them', () => {
    const { engine } = setup()

    engine.onboarding.save({
      step: 'repositories',
      preset: 'solo-builder',
      roster: rosterFromPreset(teamPreset('solo-builder'), 'claude'),
      goal: '',
    })

    expect(engine.roles.list().map((r) => r.id)).toEqual(['tech-lead'])
  })

  it('hires the roster on its models, keeps the connected repos and starts every Session', () => {
    const { engine, provider } = setup()
    engine.repos.add({ path: onDisk('/code/web-app'), stack: readyStack() })
    const roster = squad()

    const outcome = engine.onboarding.finish({ hires: roster, goal: null })

    expect(engine.employees.list().map((e) => ({ name: e.name, model: e.model }))).toEqual(
      roster.map((hire) => ({ name: hire.name, model: hire.model })),
    )
    expect(outcome.hired.map((e) => e.name)).toEqual(roster.map((hire) => hire.name))
    expect(engine.repos.list().map((r) => r.name)).toEqual(['web-app'])
    expect(outcome.started).toEqual(outcome.hired.map((e) => e.id))
    expect(provider.spawns.map((s) => s.request.employee.name)).toEqual(roster.map((hire) => hire.name))
    expect(engine.sessions.list().every((s) => s.status !== 'off')).toBe(true)
  })

  it('starts Sessions only up to the concurrency cap and parks the rest', () => {
    const { engine, provider } = setup()
    engine.capacity.setConcurrencyCap(2)

    engine.onboarding.finish({ hires: squad(), goal: null })

    expect(provider.spawns).toHaveLength(2)
    expect(engine.capacity.get()).toMatchObject({ running: 2, parked: [expect.anything(), expect.anything()] })
  })

  it('under Supervised starts only the intake holder, leaving the others off', () => {
    const { engine, provider } = setup()
    engine.approvals.setLevel('supervised')

    const outcome = engine.onboarding.finish({ hires: squad(), goal: 'Add auth with magic links' })

    const hera = byName(engine, 'Hera')
    expect(outcome.started).toEqual([hera.id])
    expect(provider.spawns.map((s) => s.request.employee.name)).toEqual(['Hera'])
    expect(status(engine, 'Orion')).toBe('off')
    expect(outcome.intakeId).toBe(hera.id)
  })

  it('DMs the goal to the intake holder with the welcome and planning instruction', () => {
    const { engine } = setup()

    const outcome = engine.onboarding.finish({
      hires: squad(),
      goal: '  Ship a checkout page that takes a card.  ',
    })

    const hera = byName(engine, 'Hera')
    expect(outcome.intakeId).toBe(hera.id)
    expect(dmOf(engine, 'Hera')).toEqual([
      expect.objectContaining({ id: outcome.goalMessage!.id, authorId: BOSS, text: expect.any(String) }),
    ])
    const text = dmOf(engine, 'Hera')[0]!.text
    expect(text).toContain('Ship a checkout page that takes a card.')
    expect(text).toContain('#general')
    expect(text).toMatch(/target, epics and tickets/)
    expect(engine.inbox.list(hera.id)).toEqual([expect.objectContaining({ kind: 'dm' })])
    expect(engine.inbox.list(byName(engine, 'Orion').id)).toEqual([])
  })

  it('opens with an empty board: everything but the DM', () => {
    const { engine, provider } = setup()

    const outcome = engine.onboarding.finish({ hires: squad(), goal: null })

    expect(outcome).toMatchObject({ intakeId: null, goalMessage: null })
    expect(dmOf(engine, 'Hera')).toEqual([])
    expect(engine.chat().read({ channelId: 'general' })).toEqual([])
    expect(engine.inbox.list(byName(engine, 'Hera').id)).toEqual([])
    expect(provider.spawns).toHaveLength(4)
    expect(engine.board().snapshot().tickets).toEqual([])
    expect(engine.onboarding.completedAt()).not.toBeNull()
  })

  it('treats a blank goal as an empty board', () => {
    const { engine } = setup()

    expect(engine.onboarding.finish({ hires: squad(), goal: '   ' })).toMatchObject({ goalMessage: null })
    expect(dmOf(engine, 'Hera')).toEqual([])
  })

  it('DMs the goal to the next in the chain when nobody takes intake (decision 41)', () => {
    const { engine } = setup()
    const hires = rosterHires(rosterFromPreset(teamPreset('product-squad'), 'claude')).filter((h) => h.roleId !== 'pm')

    const outcome = engine.onboarding.finish({ hires, goal: 'Migrate the API to Postgres' })

    const answerer = engine.employees.list().find((e) => e.id === outcome.intakeId)
    expect(answerer?.capabilities).toContain('plan')
    expect(engine.chat().read({ channelId: 'general' })).toEqual([])
  })

  it('keeps the goal in #general when nobody is hired', () => {
    const { engine } = setup()

    const outcome = engine.onboarding.finish({ hires: [], goal: 'Migrate the API to Postgres' })

    expect(outcome.intakeId).toBeNull()
    expect(engine.chat().read({ channelId: 'general' })).toEqual([
      expect.objectContaining({ authorId: BOSS, text: 'Migrate the API to Postgres' }),
    ])
  })

  it('marks the wizard finished, on the summary too, and refuses a second run', () => {
    const { engine, company } = setup()

    engine.onboarding.finish({ hires: [], goal: null })

    const at = engine.onboarding.completedAt()
    expect(at).toEqual(expect.any(String))
    expect(engine.companySummaries().find((c) => c.id === company.id)?.onboardingCompletedAt).toBe(at)
    expect(() => engine.onboarding.finish({ hires: squad(), goal: null })).toThrow(/already finished/)
    expect(engine.employees.list()).toEqual([])
  })

  it('hires nobody and stays unfinished when one hire is invalid', () => {
    const { engine, provider } = setup()
    const hires = [...squad(), { name: 'Hera', roleId: 'qa' }]

    expect(() => engine.onboarding.finish({ hires, goal: 'Anything' })).toThrow()

    expect(engine.employees.list()).toEqual([])
    expect(provider.spawns).toEqual([])
    expect(engine.onboarding.completedAt()).toBeNull()
  })

  it('still finishes when a Session cannot start, and says why', () => {
    const logged: string[] = []
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      log: (line) => logged.push(line),
    })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/offline') })

    const outcome = engine.onboarding.finish({ hires: squad(), goal: 'Set up CI' })

    expect(outcome.hired).toHaveLength(4)
    expect(outcome.started).toEqual([])
    expect(outcome.intakeId).toBe(byName(engine, 'Hera').id)
    expect(engine.onboarding.completedAt()).not.toBeNull()
    expect(logged).toHaveLength(4)
    expect(logged[0]).toMatch(/^Setup: could not start Hera: /)
  })

  it('holds the Sessions of a paused Company for Resume all', () => {
    const { engine, provider, logged } = setup()
    engine.sessions.stopAll()

    const outcome = engine.onboarding.finish({ hires: squad().slice(0, 1), goal: null })
    expect(provider.spawns).toEqual([])
    engine.sessions.startAll()

    expect(logged).toEqual([])
    expect(provider.spawns.map((s) => s.request.employee.id)).toEqual(outcome.started)
  })
})

/** A Company opened by a build that did not have the migration named `skip`. */
function companyBefore(skip: string): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const at = migrations.findIndex((m) => m.name === skip)
  runMigrations(db, migrations.slice(0, at))
  db.prepare("INSERT INTO company (id, name, created_at) VALUES ('c', 'Old Co', '2026-01-01T00:00:00.000Z')").run()
  return db
}

const completedAt = (db: DatabaseSync) =>
  (db.prepare('SELECT onboarding_completed_at AS at FROM company').get() as { at: string | null }).at

describe('The onboarding migrations', () => {
  it('counts Companies made before the wizard as finished', () => {
    const db = companyBefore('company-onboarding-completed')

    runMigrations(db, migrations)

    expect(completedAt(db)).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    db.close()
  })

  it('counts a Company made before the wizard was resumable as finished, wherever it stopped', () => {
    // It has been in use since before anything was stored for it: there is no step to go back to,
    // and dropping the boss into the wizard now would be a regression, not a resume.
    const db = companyBefore('company-onboarding-progress')
    db.prepare('UPDATE company SET onboarding_completed_at = NULL').run()

    runMigrations(db, migrations)

    expect(completedAt(db)).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    db.close()
  })

  it('leaves the completion it finds alone, so a finished Company keeps when it finished', () => {
    const db = companyBefore('company-onboarding-progress')
    db.prepare("UPDATE company SET onboarding_completed_at = '2026-02-02T02:02:02.000Z'").run()

    runMigrations(db, migrations)

    expect(completedAt(db)).toBe('2026-02-02T02:02:02.000Z')
    db.close()
  })

  it('leaves a Company being created now unfinished: its row lands after its migrations', () => {
    const { engine, company } = setup()

    expect(engine.onboarding.completedAt()).toBeNull()
    expect(engine.companySummaries().find((c) => c.id === company.id)?.onboardingCompletedAt).toBeNull()
  })
})

describe('Setup wizard progress', () => {
  const draft = (patch: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
    step: 'repositories',
    preset: 'product-squad',
    roster: rosterFromPreset(teamPreset('product-squad'), 'claude'),
    goal: 'Add auth with magic links',
    ...patch,
  })

  it('starts with nothing to resume: a Company that saved no step opens the wizard at its start', () => {
    const { engine } = setup()

    expect(engine.onboarding.progress()).toEqual({ completedAt: null, draft: null })
  })

  it('hands back the step, preset, roster and goal it was given', () => {
    const { engine } = setup()

    engine.onboarding.save(draft())

    expect(engine.onboarding.progress()).toEqual({ completedAt: null, draft: draft() })
  })

  it('keeps the last save, so every step change moves where the wizard reopens', () => {
    const { engine } = setup()
    const edited = rosterFromPreset(teamPreset('solo-builder'), 'claude').map((seat) => ({ ...seat, name: 'Root' }))

    engine.onboarding.save(draft({ step: 'preset' }))
    engine.onboarding.save(draft({ step: 'team', preset: 'solo-builder', roster: edited, goal: '' }))

    expect(engine.onboarding.progress().draft).toEqual({
      step: 'team',
      preset: 'solo-builder',
      roster: edited,
      goal: '',
    })
  })

  it('survives the app being closed and opened again — the wizard comes back to its step', () => {
    const folder = mkdtempSync(join(tmpdir(), 'onboarding-'))
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder, name: 'Tiny Corp' })
    first.onboarding.save(draft())
    first.close()
    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)

    second.openCompany(folder)

    expect(second.onboarding.progress()).toEqual({ completedAt: null, draft: draft() })
  })

  it('clears the draft on Finish and never resumes again', () => {
    const { engine } = setup()
    engine.onboarding.save(draft())

    engine.onboarding.finish({ hires: squad(), goal: 'Add auth with magic links' })

    const progress = engine.onboarding.progress()
    expect(progress.draft).toBeNull()
    expect(progress.completedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
  })

  it('ignores a save that lands after Finish, so nothing revives the wizard', () => {
    const { engine } = setup()
    engine.onboarding.finish({ hires: [], goal: null })

    engine.onboarding.save(draft())

    expect(engine.onboarding.progress().draft).toBeNull()
  })

  it('starts the wizard over rather than crashing on a draft it can no longer read', () => {
    const { engine, database } = setup()
    engine.onboarding.save(draft())
    database().prepare("UPDATE company SET onboarding_roster = '{ not json'").run()

    expect(engine.onboarding.progress()).toEqual({ completedAt: null, draft: null })
  })

  it('starts the wizard over on a step this build no longer has', () => {
    const { engine, database } = setup()
    engine.onboarding.save(draft())
    database().prepare("UPDATE company SET onboarding_step = 'billing'").run()

    expect(engine.onboarding.progress().draft).toBeNull()
  })
})
