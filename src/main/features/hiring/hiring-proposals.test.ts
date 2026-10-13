import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffingOutcome } from '../../../shared/hiring'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-17T09:00:00Z'))
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
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  return { engine, pam, ada }
}

function pending(outcome: StaffingOutcome) {
  if (outcome.status !== 'pending') throw new Error(`Expected a pending request, got ${outcome.status}`)
  return outcome
}

const MINUTE = 60_000

describe('Hire proposals', () => {
  it('store the proposed Employee from the role, under a name nobody has', () => {
    const { engine, pam } = setup()
    const frontend = engine.roles.ensure(['frontend'])[0]!

    const { request } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
    )

    expect(request.proposal).toEqual({
      name: expect.stringMatching(/^\p{Lu}\p{L}+$/u),
      roleId: 'frontend',
      persona: frontend.persona,
      capabilities: frontend.capabilities,
      repoFilter: frontend.repoFilter,
      areas: frontend.areas,
      model: null,
    })
    expect(['Pam', 'Ada']).not.toContain(request.proposal!.name)
    expect(engine.approvals.list()[0]!.subject).toContain(request.proposal!.name)
  })

  it('give two pending proposals different names', () => {
    const { engine, pam } = setup()

    const names = Array.from(
      { length: 5 },
      () =>
        pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' })).request.proposal!.name,
    )

    expect(new Set(names).size).toBe(5)
  })

  it('can be edited by the boss before approval, and approval hires the edited Employee', () => {
    const { engine, pam } = setup()
    const { request, approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
    )

    const edited = engine.hiring.updateProposal(request.id, {
      name: 'Lyra',
      roleId: 'devops',
      persona: 'Ships the landing page.',
      capabilities: ['review', 'code'],
      repoFilter: ['web-app', ' ', 'web-app'],
      model: 'opus-5-deep',
    })

    expect(edited.proposal).toEqual({
      name: 'Lyra',
      roleId: 'devops',
      persona: 'Ships the landing page.',
      capabilities: ['code', 'review'],
      repoFilter: ['web-app'],
      areas: [],
      model: 'opus-5-deep',
    })
    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ roleId: 'devops', proposal: edited.proposal })])

    engine.approvals.decide(approvalId, { approve: true })

    const lyra = engine.employees.list().find((e) => e.name === 'Lyra')
    expect(lyra).toMatchObject({
      roleId: 'devops',
      title: 'DevOps',
      persona: 'Ships the landing page.',
      capabilities: ['code', 'review'],
      repoFilter: ['web-app'],
      areas: [],
      model: 'opus-5-deep',
    })
    expect(engine.hiring.requests()).toEqual([
      expect.objectContaining({ status: 'done', employeeId: lyra!.id, model: 'opus-5-deep' }),
    ])
  })

  it('hire fields the boss left alone from the role as it is at approval, and keep the edited ones as overrides', () => {
    const { engine, pam } = setup()
    const { request, approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }),
    )
    engine.hiring.updateProposal(request.id, { name: 'Quinn', repoFilter: ['web-app'] })
    engine.roles.update('qa', { persona: 'The QA role, rewritten.', capabilities: ['code', 'review'] })

    engine.approvals.decide(approvalId, { approve: true })

    const quinn = engine.employees.list().find((e) => e.name === 'Quinn')
    expect(quinn).toMatchObject({
      persona: 'The QA role, rewritten.',
      capabilities: ['code', 'review'],
      repoFilter: ['web-app'],
      overrides: ['repoFilter'],
    })
  })

  it('rebase on a new role when the boss changes it, so its untouched fields follow that role', () => {
    const { engine, pam } = setup()
    const devops = engine.roles.ensure(['devops'])[0]!
    const { request, approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }),
    )
    engine.hiring.updateProposal(request.id, {
      name: 'Dev',
      roleId: 'devops',
      persona: devops.persona,
      capabilities: devops.capabilities,
      repoFilter: devops.repoFilter,
    })

    engine.approvals.decide(approvalId, { approve: true })

    expect(engine.employees.list().find((e) => e.name === 'Dev')).toMatchObject({ roleId: 'devops', overrides: [] })
  })

  it('share one model with setRequestModel, and hire on it', () => {
    const { engine, pam } = setup()
    const { request, approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs', model: 'sonnet-5-fast' }),
    )
    expect(request.proposal!.model).toBe('sonnet-5-fast')

    engine.hiring.setRequestModel(request.id, 'haiku-4-5-fast')
    const edited = engine.hiring.updateProposal(request.id, { name: 'Quinn' })
    expect(edited).toMatchObject({ model: 'haiku-4-5-fast', proposal: { name: 'Quinn', model: 'haiku-4-5-fast' } })

    engine.approvals.decide(approvalId, { approve: true })

    expect(engine.employees.list().find((e) => e.name === 'Quinn')?.model).toBe('haiku-4-5-fast')
  })

  it('keep the fields a partial edit leaves out', () => {
    const { engine, pam } = setup()
    const { request } = pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))

    const edited = engine.hiring.updateProposal(request.id, { persona: 'Tests everything.' })

    expect(edited.proposal).toEqual({ ...request.proposal, persona: 'Tests everything.' })
  })

  it('refuse bad edits and leave the proposal as it was', () => {
    const { engine, pam } = setup()
    const { request } = pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))
    const hiring = engine.hiring

    expect(() => hiring.updateProposal(request.id, { name: ' ' })).toThrow(/name/i)
    expect(() => hiring.updateProposal(request.id, { name: 'ada' })).toThrow(/already exists/i)
    expect(() => hiring.updateProposal(request.id, { roleId: 'wizard' })).toThrow(/unknown role/i)
    expect(() => hiring.updateProposal(request.id, { capabilities: ['fly' as never] })).toThrow(/capabilities/i)
    expect(() => hiring.updateProposal(request.id, { repoFilter: 'web' as never })).toThrow(/repo filter/i)
    expect(() => hiring.updateProposal(request.id, { model: 'gpt-9' })).toThrow(/unknown model/i)
    expect(() => hiring.updateProposal(999, { name: 'Zed' })).toThrow(/no hire request/i)

    expect(hiring.requests()[0]!.proposal).toEqual(request.proposal)
  })

  it('cannot be edited once decided, nor for fires and rehires', () => {
    const { engine, pam, ada } = setup()
    const hire = pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))
    engine.approvals.decide(hire.approvalId, { approve: false, reason: 'No' })
    const fire = pending(engine.hiring.requestFire({ requesterId: pam.id, employeeId: ada.id, reason: 'Idle' }))
    engine.hiring.fire(ada.id)
    const rehire = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'backend', reason: 'API', name: 'Ada' }),
    )

    expect(() => engine.hiring.updateProposal(hire.request.id, { name: 'Zed' })).toThrow(/already rejected/i)
    expect(() => engine.hiring.updateProposal(fire.request.id, { name: 'Zed' })).toThrow(/only a new-hire/i)
    expect(rehire.request.proposal).toBeNull()
    expect(() => engine.hiring.updateProposal(rehire.request.id, { name: 'Zed' })).toThrow(/only a new-hire/i)
  })

  it('notify staff listeners when edited', () => {
    const { engine, pam } = setup()
    const { request } = pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))
    const listener = vi.fn()
    engine.employees.onChange(listener)

    engine.hiring.updateProposal(request.id, { name: 'Quinn' })

    expect(listener).toHaveBeenCalled()
  })

  it('suggest names nobody has, proposed or on staff', () => {
    const { engine, pam } = setup()
    const { request } = pending(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))

    const names = Array.from({ length: 30 }, () => engine.hiring.suggestName())

    expect(names).not.toContain(request.proposal!.name)
    expect(names).not.toContain('Pam')
    expect(names.every((n) => /^\p{Lu}\p{L}+$/u.test(n))).toBe(true)
  })
})

describe('Maximum headcount', () => {
  it('is unlimited by default and can be set and cleared', () => {
    const { engine } = setup()

    expect(engine.hiring.headcount()).toEqual({ current: 2, max: null })
    expect(engine.hiring.setMaxHeadcount(3)).toEqual({ current: 2, max: 3 })
    expect(engine.hiring.teamLoad().headcount).toEqual({ current: 2, max: 3 })
    expect(engine.hiring.setMaxHeadcount(null)).toEqual({ current: 2, max: null })
  })

  it('must be a whole number from 1', () => {
    const { engine } = setup()

    for (const bad of [0, -1, 2.5, '3']) {
      expect(() => engine.hiring.setMaxHeadcount(bad as never)).toThrow(/headcount/i)
    }
    expect(engine.hiring.headcount().max).toBeNull()
  })

  it('under Autonomous, lets hires through up to the maximum and asks above it', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')
    engine.hiring.setMaxHeadcount(3)

    const first = engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' })
    const second = engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'More bugs' })

    expect(first.status).toBe('done')
    expect(second.status).toBe('pending')
    expect(engine.approvals.list()).toEqual([expect.objectContaining({ action: 'hire', status: 'pending' })])
    expect(engine.employees.list()).toHaveLength(3)
  })

  it('under Autonomous without a maximum, never asks', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')

    for (let i = 0; i < 3; i++) {
      expect(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }).status).toBe('done')
    }
  })
})

describe('Team load details', () => {
  it('reports WIP and headcount per role, every role listed', () => {
    const { engine, pam, ada } = setup()
    const bea = engine.employees.create({ name: 'Bea', roleId: 'backend' })
    // A role the Company holds and nobody is on: it is still a row of the load table.
    engine.roles.ensure(['frontend'])
    const board = engine.board()
    board.createTicket({ title: 'API', assigneeId: ada.id })
    board.createTicket({ title: 'Jobs', assigneeId: bea.id })
    board.moveTicket(board.createTicket({ title: 'Old', assigneeId: bea.id }).id, 'done')
    board.createTicket({ title: 'Plan', assigneeId: pam.id })
    board.createTicket({ title: 'Nobody' })

    const { roleLoad } = engine.hiring.teamLoad()

    expect(roleLoad).toContainEqual({ roleId: 'backend', name: 'Backend', employees: 2, wip: 2 })
    expect(roleLoad).toContainEqual({ roleId: 'pm', name: 'PM', employees: 1, wip: 1 })
    expect(roleLoad).toContainEqual({ roleId: 'frontend', name: 'Frontend', employees: 0, wip: 0 })
    expect(roleLoad).toHaveLength(engine.roles.list().length)
  })

  it('counts Todo tickets per repo, busiest first, and blocked open tickets', () => {
    const { engine, ada } = setup()
    const stack = readyStack()
    const web = engine.repos.add({ path: onDisk('/code/web'), stack })
    const api = engine.repos.add({ path: onDisk('/code/api'), stack })
    const board = engine.board()
    // Ready, not Planning: the load is about work that can be picked up (T171).
    board.createTicket({ title: 'A', column: 'todo', repos: [api.id] })
    board.createTicket({ title: 'B', column: 'todo', repos: [web.id, api.id], assigneeId: ada.id })
    board.moveTicket(board.createTicket({ title: 'C', repos: [web.id] }).id, 'doing')
    const stuck = board.createTicket({ title: 'D' })
    board.updateTicket(stuck.id, { blocked: true, blockedReason: 'Waiting on keys' })
    const gone = board.createTicket({ title: 'E' })
    board.updateTicket(gone.id, { blocked: true })
    board.moveTicket(gone.id, 'done')

    const load = engine.hiring.teamLoad()

    expect(load.todoByRepo).toEqual([
      { repo: 'api', count: 2 },
      { repo: 'web', count: 1 },
    ])
    expect(load.blocked).toBe(1)
  })

  it('averages the time tickets spent in Review, from when they entered and left it', () => {
    const { engine } = setup()
    const board = engine.board()
    const a = board.createTicket({ title: 'A' })
    const b = board.createTicket({ title: 'B' })
    const c = board.createTicket({ title: 'C' })

    expect(engine.hiring.teamLoad().review).toEqual({ averageMs: null, stays: 0 })

    board.moveTicket(a.id, 'review')
    board.moveTicket(b.id, 'review')
    vi.advanceTimersByTime(30 * MINUTE)
    board.moveTicket(a.id, 'done')
    board.moveTicket(c.id, 'review')
    vi.advanceTimersByTime(60 * MINUTE)
    board.moveTicket(b.id, 'doing')
    board.moveTicket(b.id, 'doing', 0)
    vi.advanceTimersByTime(8 * 60 * MINUTE)

    // A stayed 30 min, B 90 min; C is still in Review and does not count yet.
    expect(engine.hiring.teamLoad().review).toEqual({ averageMs: 60 * MINUTE, stays: 2 })
  })

  it('does not count a reorder inside Review as leaving it', () => {
    const { engine } = setup()
    const board = engine.board()
    const a = board.createTicket({ title: 'A', column: 'review' })
    board.createTicket({ title: 'B', column: 'review' })
    vi.advanceTimersByTime(10 * MINUTE)
    board.moveTicket(a.id, 'review', 1)
    vi.advanceTimersByTime(10 * MINUTE)
    board.moveTicket(a.id, 'done')

    expect(engine.hiring.teamLoad().review).toEqual({ averageMs: 20 * MINUTE, stays: 1 })
  })
})
