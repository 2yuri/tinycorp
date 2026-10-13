import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { FALLBACK_PROVIDER, PROVIDER_MODELS, PROVIDERS, type Provider } from '../../../shared/domain/providers'
import type { StaffingOutcome } from '../../../shared/hiring'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { notesLogFile } from '../sessions/instructions'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup({
  folder = onDisk('/work/acme'),
  defaultProvider,
}: {
  folder?: string
  defaultProvider?: () => Provider
} = {}) {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider, codex: fakeProvider(), opencode: fakeProvider() },
    isGitRepo: () => true,
    log: () => {},
    ...(defaultProvider !== undefined && { defaultProvider }),
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder, name: 'Acme' })
  const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }

  return { engine, provider, acme, pam, ada, startIdle }
}

function pending(outcome: StaffingOutcome) {
  if (outcome.status !== 'pending') throw new Error(`Expected a pending request, got ${outcome.status}`)
  return outcome
}

function done(outcome: StaffingOutcome) {
  if (outcome.status !== 'done') throw new Error(`Expected a done request, got ${outcome.status}`)
  return outcome
}

describe('Team load', () => {
  it('counts each Employee’s tickets that are not done', () => {
    const { engine, pam, ada } = setup()
    const board = engine.board()
    board.createTicket({ title: 'API', assigneeId: ada.id })
    const doing = board.createTicket({ title: 'Auth', assigneeId: ada.id })
    board.moveTicket(doing.id, 'doing')
    const shipped = board.createTicket({ title: 'Shipped', assigneeId: ada.id })
    board.moveTicket(shipped.id, 'done')

    const load = engine.hiring.teamLoad()

    expect(load.employees).toEqual([
      expect.objectContaining({ id: pam.id, name: 'Pam', title: 'PM', wip: 0, tickets: [] }),
      expect.objectContaining({
        id: ada.id,
        name: 'Ada',
        title: 'Backend',
        capabilities: ['code'],
        wip: 2,
        tickets: [
          expect.objectContaining({ title: 'API', column: 'planning' }),
          expect.objectContaining({ title: 'Auth', column: 'doing' }),
        ],
      }),
    ])
  })

  it('lists unassigned tickets that are not done, with their repo names', () => {
    const { engine } = setup()
    const repo = engine.repos.add({
      path: onDisk('/code/web'),
      stack: { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' },
    })
    const board = engine.board()
    const open = board.createTicket({ title: 'Landing page', repos: [repo.id] })
    const closed = board.createTicket({ title: 'Old' })
    board.moveTicket(closed.id, 'done')

    expect(engine.hiring.teamLoad().unassigned).toEqual([
      { id: open.id, title: 'Landing page', column: 'planning', repos: ['web'] },
    ])
  })

  it('reports column WIP against limits', () => {
    const { engine, ada } = setup()
    const board = engine.board()
    board.setWipLimit('doing', 1)
    for (const title of ['A', 'B']) board.moveTicket(board.createTicket({ title, assigneeId: ada.id }).id, 'doing')

    expect(engine.hiring.teamLoad().columns).toContainEqual({
      id: 'doing',
      wipLimit: 1,
      count: 2,
      overLimit: true,
    })
  })

  it('names capabilities nobody holds and the roles that hold them', () => {
    const { engine } = setup()

    const gaps = engine.hiring.teamLoad().skillGaps

    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'capability', capability: 'review', roles: ['Tech Lead', 'QA', 'Security'] }),
    )
    expect(gaps).not.toContainEqual(expect.objectContaining({ capability: 'code' }))
    expect(gaps).not.toContainEqual(expect.objectContaining({ capability: 'intake' }))
  })

  it('does not warn about intake when a planner answers the boss (decision 41)', () => {
    const { engine } = setup()
    for (const employee of engine.employees.list()) engine.hiring.fire(employee.id)
    engine.employees.create({ name: 'Tess', roleId: 'tech-lead' })

    const gaps = engine.hiring.teamLoad().skillGaps

    expect(gaps).not.toContainEqual(expect.objectContaining({ capability: 'intake' }))
  })

  it('warns about intake when nobody plans either', () => {
    const { engine } = setup()
    for (const employee of engine.employees.list()) engine.hiring.fire(employee.id)
    engine.employees.create({ name: 'Bruno', roleId: 'backend' })

    expect(engine.hiring.teamLoad().skillGaps).toContainEqual(
      expect.objectContaining({ kind: 'capability', capability: 'intake' }),
    )
  })

  it('names repos no coder covers and the roles that would', () => {
    const { engine, ada } = setup()
    const stack = { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' }
    engine.repos.add({ path: onDisk('/code/web'), stack })
    engine.repos.add({ path: onDisk('/code/api'), stack })
    // The one Employee who codes is shut out of `web` by its own filter, which is the gap.
    engine.employees.update(ada.id, { repoFilter: ['api'] })

    const repoGaps = engine.hiring.teamLoad().skillGaps.filter((g) => g.kind === 'repo')

    expect(repoGaps).toEqual([
      expect.objectContaining({
        kind: 'repo',
        repo: 'web',
        // Every role that codes would fill it, Backend included: a role's repos are not its layer.
        roles: ['Tech Lead', 'Frontend', 'Backend', 'DevOps', 'QA', 'Security'],
      }),
    ])
  })

  /** T239: a Backend that works in every repo covers the whole Company, monorepo or not. */
  it('names no repo gap when the one coder is let into every repo', () => {
    const { engine } = setup()
    const stack = { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' }
    engine.repos.add({ path: onDisk('/code/tinycorp'), stack })

    expect(engine.hiring.teamLoad().skillGaps.filter((g) => g.kind === 'repo')).toEqual([])
  })
})

describe('Hire requests', () => {
  it('need the hire capability', () => {
    const { engine, ada } = setup()

    expect(() =>
      engine.hiring.requestHire({ requesterId: ada.id, role: 'frontend', reason: 'Too much UI work' }),
    ).toThrow(/hire capability/i)
    expect(engine.approvals.list()).toEqual([])
  })

  it('need a role from the catalog and a reason', () => {
    const { engine, pam } = setup()

    expect(() => engine.hiring.requestHire({ requesterId: pam.id, role: 'wizard', reason: 'Magic' })).toThrow(
      /unknown role/i,
    )
    expect(() => engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: ' ' })).toThrow(/reason/i)
    expect(engine.approvals.list()).toEqual([])
  })

  it('under Managed, open an approval thread for the boss and hire nobody yet', () => {
    const { engine, pam } = setup()

    const outcome = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'Frontend', reason: 'Five UI tickets unassigned' }),
    )

    const [approval] = engine.approvals.list()
    expect(approval).toMatchObject({
      id: outcome.approvalId,
      action: 'hire',
      requesterId: pam.id,
      status: 'pending',
      reason: 'Five UI tickets unassigned',
    })
    expect(approval!.subject).toMatch(/frontend/i)
    expect(engine.chat().read({ channelId: 'general' })).toEqual([
      expect.objectContaining({ id: approval!.messageId, authorId: pam.id, mentions: [BOSS] }),
    ])
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam', 'Ada'])
    expect(engine.hiring.requests()).toEqual([
      expect.objectContaining({ kind: 'hire', roleId: 'frontend', status: 'pending', employeeId: null, name: null }),
    ])
  })

  it('hire on the Company’s permission default, like every other way in (T164)', () => {
    const { engine, pam } = setup()
    engine.employees.setPermissionDefault('interactive')
    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog', name: 'Lyra' }),
    )

    engine.approvals.decide(approvalId, { approve: true })

    // HR's tools name no permission mode, so the hire takes the Company's — nothing in the hiring
    // path has to know what the default is, and none of them can drift from the hire form.
    expect(engine.employees.list().find((e) => e.name === 'Lyra')?.permissionMode).toBe('interactive')
  })

  it('keep the name a hire was proposed under', () => {
    const { engine, pam } = setup()

    engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog', name: '@Lyra' })

    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ kind: 'hire', name: 'Lyra' })])
  })

  it('once approved, spawn the Employee from the role with a new name, sprite and desk, who says hello', () => {
    const { engine, provider, pam } = setup()
    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
    )

    engine.approvals.decide(approvalId, { approve: true })

    const hired = engine.employees.list().find((e) => e.name !== 'Pam' && e.name !== 'Ada')!
    expect(hired).toMatchObject({
      roleId: 'frontend',
      title: 'Frontend',
      capabilities: ['code'],
      desk: 2,
      sprite: 2,
    })
    expect(hired.name).toMatch(/^\p{Lu}\p{L}+$/u)
    expect(provider.spawnOf(hired.id).request.employee.id).toBe(hired.id)
    expect(engine.sessions.get(hired.id).status).toBe('starting')
    const hello = engine.chat().read({ channelId: 'general' }).at(-1)!
    expect(hello).toMatchObject({ authorId: hired.id, threadId: null })
    expect(hello.text).toContain(hired.name)
    expect(hello.text).toMatch(/frontend/i)
    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ status: 'done', employeeId: hired.id })])
  })

  it('give every hire a name nobody in the Company has, fired or not', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')

    const names = Array.from({ length: 4 }, () => {
      const { employee } = done(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))
      engine.hiring.fire(employee.id)
      return employee.name
    })

    expect(new Set([...names, 'Pam', 'Ada']).size).toBe(6)
  })

  it('when rejected, hire nobody and tell the requester why', () => {
    const { engine, pam } = setup()
    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
    )

    engine.approvals.decide(approvalId, { approve: false, reason: 'Not this quarter' })

    expect(engine.employees.list()).toHaveLength(2)
    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ status: 'rejected' })])
    expect(engine.inbox.list(pam.id)).toEqual([
      expect.objectContaining({ kind: 'approval', prompt: expect.stringContaining('Not this quarter') }),
    ])
  })

  it('under Autonomous, hire right away without an approval', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')

    const { employee, request } = done(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'backend', reason: 'API backlog' }),
    )

    expect(engine.approvals.list()).toEqual([])
    expect(request).toMatchObject({ approvalId: null, status: 'done', employeeId: employee.id })
    expect(engine.employees.list().map((e) => e.id)).toContain(employee.id)
  })

  it('still hire when the new Employee cannot start now, and park them beyond the cap', () => {
    const { engine, pam, ada, startIdle } = setup()
    engine.capacity.setConcurrencyCap(1)
    startIdle(ada.id)
    engine.approvals.setLevel('autonomous')

    const { employee } = done(engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' }))

    expect(engine.sessions.get(employee.id).status).toBe('parked')
  })

  it('notify staff listeners when someone is hired', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')
    const listener = vi.fn()
    engine.employees.onChange(listener)

    engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs' })

    expect(listener).toHaveBeenCalled()
  })
})

describe('Firing', () => {
  it('is always gated when an Employee asks, even under Autonomous', () => {
    const { engine, pam, ada } = setup()
    engine.approvals.setLevel('autonomous')

    const outcome = pending(engine.hiring.requestFire({ requesterId: pam.id, employeeId: ada.id, reason: 'Idle' }))

    expect(engine.approvals.list()).toEqual([
      expect.objectContaining({ id: outcome.approvalId, action: 'fire', subject: expect.stringContaining('Ada') }),
    ])
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam', 'Ada'])
  })

  it('needs the hire capability and someone who works here', () => {
    const { engine, pam, ada } = setup()

    expect(() => engine.hiring.requestFire({ requesterId: ada.id, employeeId: pam.id, reason: 'x' })).toThrow(
      /hire capability/i,
    )
    expect(() => engine.hiring.requestFire({ requesterId: pam.id, employeeId: 'nobody', reason: 'x' })).toThrow(
      /unknown employee/i,
    )
    expect(() => engine.hiring.requestFire({ requesterId: pam.id, employeeId: pam.id, reason: 'x' })).toThrow(
      /yourself/i,
    )
  })

  it('once approved, stops the Session, frees the desk and removes the Employee', () => {
    const { engine, provider, pam, ada, startIdle } = setup()
    startIdle(ada.id)
    const { approvalId } = pending(
      engine.hiring.requestFire({ requesterId: pam.id, employeeId: ada.id, reason: 'Project over' }),
    )

    engine.approvals.decide(approvalId, { approve: true })

    expect(provider.spawnOf(ada.id).pty.killed).toBe(true)
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam'])
    expect(engine.sessions.list().map((s) => s.employeeId)).toEqual([pam.id])
    expect(
      engine
        .chat()
        .people()
        .map((p) => p.name),
    ).toEqual(['Pam'])
    expect(engine.hiring.former()).toEqual([expect.objectContaining({ id: ada.id, name: 'Ada' })])
    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ kind: 'fire', status: 'done' })])
    const next = engine.employees.create({ name: 'Bea', roleId: 'qa' })
    expect(next.desk).toBe(ada.desk)
  })

  it('when rejected, keeps the Employee', () => {
    const { engine, pam, ada } = setup()
    const { approvalId } = pending(engine.hiring.requestFire({ requesterId: pam.id, employeeId: ada.id, reason: 'x' }))

    engine.approvals.decide(approvalId, { approve: false, reason: 'Ada stays' })

    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam', 'Ada'])
  })

  it('by the boss stops a parked Employee too, unassigns their open tickets and says so in #general', () => {
    const { engine, pam, ada, startIdle } = setup()
    engine.capacity.setConcurrencyCap(1)
    startIdle(pam.id)
    engine.sessions.start(ada.id)
    const board = engine.board()
    const open = board.createTicket({ title: 'API', assigneeId: ada.id })
    const shipped = board.createTicket({ title: 'Old', assigneeId: ada.id })
    board.moveTicket(shipped.id, 'done')

    engine.hiring.fire(ada.id, 'Budget cuts')

    expect(engine.capacity.get().parked).toEqual([])
    const tickets = engine.board().snapshot().tickets
    expect(tickets.find((t) => t.id === open.id)!.assigneeId).toBeNull()
    expect(tickets.find((t) => t.id === shipped.id)!.assigneeId).toBe(ada.id)
    expect(engine.hiring.teamLoad().unassigned.map((t) => t.title)).toEqual(['API'])
    const farewell = engine.chat().read({ channelId: 'general' }).at(-1)!
    expect(farewell).toMatchObject({ authorId: COMPANY_AUTHOR })
    expect(farewell.text).toContain('Ada')
    expect(farewell.text).toContain('Budget cuts')
  })

  it('keeps the note log in the Company folder, so re-hiring finds it again', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hiring-'))
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
    const { engine, ada } = setup({ folder })
    const log = notesLogFile(folder, ada.id)
    mkdirSync(dirname(log), { recursive: true })
    writeFileSync(log, '2026-09-21T10:00:00.000Z\temployee\tThe api repo uses pnpm.\n')

    engine.hiring.fire(ada.id)

    expect(existsSync(log)).toBe(true)
    expect(readFileSync(log, 'utf8')).toContain('The api repo uses pnpm.')
  })

  it('keeps a fired Employee’s messages and survives reopening the Company', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hiring-'))
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder })
    const ada = first.employees.create({ name: 'Ada', roleId: 'backend' })
    first.chat().post({ authorId: ada.id, channelId: 'tech', text: 'Hello' })
    first.hiring.fire(ada.id)
    first.close()
    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)

    second.openCompany(folder)

    expect(second.employees.list()).toEqual([])
    expect(second.hiring.former().map((e) => e.name)).toEqual(['Ada'])
    expect(second.chat().read({ channelId: 'tech' })).toEqual([expect.objectContaining({ authorId: ada.id })])
  })

  it('refuses someone already gone', () => {
    const { engine, ada } = setup()
    engine.hiring.fire(ada.id)

    expect(() => engine.hiring.fire(ada.id)).toThrow(/unknown employee/i)
  })
})

describe('Rehiring', () => {
  it('brings a fired Employee back under the same id, at a free desk', () => {
    const { engine, pam, ada } = setup()
    engine.hiring.fire(ada.id)
    engine.employees.create({ name: 'Bea', roleId: 'qa' })

    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'backend', reason: 'API again', name: 'ada' }),
    )
    expect(engine.approvals.list()[0]!.subject).toMatch(/Ada/)
    engine.approvals.decide(approvalId, { approve: true })

    const back = engine.employees.list().find((e) => e.name === 'Ada')!
    expect(back.id).toBe(ada.id)
    expect(back.desk).toBe(2)
    expect(engine.hiring.former()).toEqual([])
    expect(engine.chat().read({ channelId: 'general' }).at(-1)).toMatchObject({ authorId: ada.id })
  })

  it('by the boss works directly', () => {
    const { engine, ada } = setup()
    engine.hiring.fire(ada.id)

    const back = engine.hiring.rehire(ada.id)

    expect(back).toMatchObject({ id: ada.id, name: 'Ada' })
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Pam', 'Ada'])
  })

  it('a hire request with a new name uses that name', () => {
    const { engine, pam } = setup()
    engine.approvals.setLevel('autonomous')

    const { employee } = done(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs', name: 'Quinn' }),
    )

    expect(employee.name).toBe('Quinn')
  })

  it('a hire request naming someone who still works here is refused', () => {
    const { engine, pam } = setup()

    expect(() => engine.hiring.requestHire({ requesterId: pam.id, role: 'qa', reason: 'Bugs', name: 'Ada' })).toThrow(
      /already/i,
    )
  })
})

/**
 * HR proposes a hire and usually names no model (T169). What that hire runs on is then the Provider
 * this Mac is ready for — read from the preflight answers the app already holds, not the
 * catalogue's first line, so a boss who has only one CLI gets Employees on it.
 *
 * Nothing here spawns a real CLI: the preflight arrives as the injected answer it always is.
 */
describe('The Provider a hire nobody named one for runs on', () => {
  it('is the one this Mac is ready for, whichever it is', () => {
    for (const only of PROVIDERS) {
      const { engine, pam } = setup({ defaultProvider: () => only })
      const { approvalId } = pending(
        engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
      )

      engine.approvals.decide(approvalId, { approve: true })

      const hired = engine.employees.list().find((e) => e.name !== 'Pam' && e.name !== 'Ada')!
      // No model: the Employee runs on that product's own default (decision 31).
      expect(hired, only).toMatchObject({ provider: only, model: null })
    }
  })

  it('is the model’s own Provider when HR names one, whatever the machine holds', () => {
    const [first] = PROVIDERS as [Provider, ...Provider[]]
    const last = PROVIDERS.at(-1)!
    const { engine, pam } = setup({ defaultProvider: () => first })
    const model = PROVIDER_MODELS[last][0]!.id
    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog', model }),
    )

    engine.approvals.decide(approvalId, { approve: true })

    const hired = engine.employees.list().find((e) => e.name !== 'Pam' && e.name !== 'Ada')!
    expect(hired).toMatchObject({ provider: last, model })
  })

  it('is the catalogue’s first when nobody has asked the CLIs yet', () => {
    const { engine, pam } = setup()
    const { approvalId } = pending(
      engine.hiring.requestHire({ requesterId: pam.id, role: 'frontend', reason: 'UI backlog' }),
    )

    engine.approvals.decide(approvalId, { approve: true })

    const hired = engine.employees.list().find((e) => e.name !== 'Pam' && e.name !== 'Ada')!
    expect(hired.provider).toBe(FALLBACK_PROVIDER)
  })
})
