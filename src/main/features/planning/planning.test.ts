import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { type PlanSubject, unanswered } from '../../../shared/planning/planning'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrations } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, readyStack } from '../../core/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** A Company with a PM who holds `plan`, an engineer, and one repo. */
function setup() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: '/work/acme', name: 'Acme' })
  const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
  const vega = engine.employees.create({ name: 'Vega', roleId: 'backend' })
  const web = engine.repos.add({ path: '/code/web', name: 'web', stack: readyStack() })
  const board = () => engine.board()
  const ticketOf = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!
  const planOf = (subject: PlanSubject) => engine.planning.of(subject)!
  const inbox = (employeeId: string) => engine.inbox.list(employeeId)
  return { engine, nova, vega, web, board, ticketOf, planOf, inbox }
}

const DRAFT = {
  goal: 'Customers see what they used over a chosen range.',
  approach: 'Add from/to to GET /usage, then a RangePicker reading the range from the URL.',
  acceptanceCriteria: ['7d, 30d, 90d and a custom range', 'The range lives in the URL'],
  risks: ['Custom ranges over a year hit the nightly aggregate'],
}

describe('A new ticket is planned before it is Ready', () => {
  it('starts in Planning with a plan at v1, and wakes whoever holds plan', () => {
    const { nova, vega, board, ticketOf, planOf, inbox } = setup()

    const ticket = board().createTicket({ title: 'Usage chart with range picker' })

    expect(ticketOf(ticket.id).column).toBe('planning')
    expect(planOf({ kind: 'ticket', id: ticket.id })).toMatchObject({
      version: 1,
      status: 'drafting',
      ticketId: ticket.id,
      channelId: 'general',
    })
    expect(inbox(nova.id)).toEqual([
      expect.objectContaining({ kind: 'planning', ticketId: ticket.id, text: expect.stringContaining('AC-1') }),
    ])
    expect(inbox(vega.id)).toEqual([])
  })

  it('says so in the planning thread, and puts a ticket’s thread in its epic’s channel', () => {
    const { engine, board, planOf } = setup()
    const epic = board().createEpic({ title: 'Usage & invoices' })

    const ticket = board().createTicket({ title: 'Usage chart', epicId: epic.id })

    const plan = planOf({ kind: 'ticket', id: ticket.id })
    expect(plan.channelId).toBe(`epic-${epic.id}-usage-invoices`)
    expect(
      engine
        .chat()
        .read({ channelId: plan.channelId })
        .map((m) => m.text),
    ).toEqual([
      'You created the epic "Usage & invoices" — it starts in Planning.',
      'You created AC-1 · Usage chart — it starts in Planning.',
    ])
  })
})

describe('Asking the boss, and answering inline', () => {
  /** A ticket with Nova's three questions on it. */
  function asked() {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    const plan = plannerOf(s).ask(subject, ['Which ranges?', 'Totals only?', 'Range in the URL?'])
    return { ...s, ticket, subject, plan }
  }

  /** Nova's side of planning, as its Session reaches it. */
  function plannerOf(s: ReturnType<typeof setup>) {
    return employeePlanning(s.engine, s.nova.id)
  }

  it('posts the numbered questions where the boss will see them', () => {
    const { engine, plan } = asked()

    const posted = engine.chat().read({ channelId: 'general' }).at(-1)!
    expect(posted.text).toContain('1. Which ranges?')
    expect(posted.text).toContain('3. Range in the URL?')
    expect(posted.mentions).toContain(BOSS)
    expect(plan.questions.map((q) => q.number)).toEqual([1, 2, 3])
  })

  it('wakes the planner once, with every answer at once', () => {
    const { engine, nova, plan, inbox } = asked()
    const planning = engine.planning
    const before = inbox(nova.id).length

    planning.answer(plan.questions[0]!.id, '7, 30, 90 days and custom. Default to 30.')
    expect(inbox(nova.id)).toHaveLength(before)
    planning.answer(plan.questions[1]!.id, 'Totals. Per-seat is a later ticket.')
    expect(inbox(nova.id)).toHaveLength(before)
    const last = planning.delegate(plan.questions[2]!.id)

    expect(unanswered(last)).toEqual([])
    const filed = inbox(nova.id).slice(before)
    expect(filed).toHaveLength(1)
    expect(filed[0]!.prompt).toContain('7, 30, 90 days and custom')
    expect(filed[0]!.prompt).toContain('the boss left this one to you')
  })

  it('refuses an approval while a question is unanswered', () => {
    const { engine, plan } = asked()

    expect(() => engine.planning.approve(plan.id)).toThrow(/question 1/i)
  })
})

describe('What waits on the boss', () => {
  it('puts an unanswered question and a drafted plan in the boss\u2019s Inbox', () => {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    const planner = employeePlanning(s.engine, s.nova.id)

    planner.ask(subject, ['Which ranges?'])
    expect(
      s.engine
        .chat()
        .bossInbox()
        .map((row) => [row.kind, row.unread]),
    ).toEqual([['mention', true]])

    s.engine.planning.answer(s.planOf(subject).questions[0]!.id, '7, 30 and 90.')
    planner.draft(subject, DRAFT)

    const rows = s.engine.chat().bossInbox()
    expect(rows.map((row) => row.kind)).toEqual(['plan', 'mention'])
    expect(rows[0]!.text).toContain('Drafted the plan')
  })

  // TI-6: the planner posted the plan, the boss was never told, and both plans sat at `waiting`
  // with no `approved_by`. A row that is only a mention carries no decision (T233).
  it('reaches the boss as a plan to decide, with the plan it is about, not as a mention', () => {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }

    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)

    const row = s.engine.chat().bossInbox()[0]!
    expect(row.kind).toBe('plan')
    expect(row.planId).toBe(s.planOf(subject).id)
    expect(s.planOf(subject).status).toBe('waiting')
  })

  it('drops the plan row the moment the boss decides it', () => {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)

    s.engine.planning.approve(s.planOf(subject).id)

    const row = s.engine
      .chat()
      .bossInbox()
      .find((one) => one.messageId === s.planOf(subject).messageId)!
    expect([row.kind, row.planId]).toEqual(['mention', null])
  })
})

describe('The gate follows autonomy', () => {
  function drafted(level: 'supervised' | 'managed' | 'autonomous', epic?: { approved: boolean }) {
    const s = setup()
    s.engine.approvals.setLevel(level)
    const epicId = epic ? s.board().createEpic({ title: 'Usage' }).id : null
    if (epic?.approved) {
      const plan = s.planOf({ kind: 'epic', id: epicId! })
      employeePlanning(s.engine, s.nova.id).draft({ kind: 'epic', id: epicId! }, DRAFT)
      s.engine.planning.approve(plan.id)
    }
    const ticket = s.board().createTicket({ title: 'Usage chart', epicId })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)
    return { ...s, ticket, subject }
  }

  it('Supervised: the boss approves every ticket’s plan', () => {
    const { engine, nova, subject, ticket, ticketOf, planOf } = drafted('supervised', { approved: true })

    expect(() => employeePlanning(engine, nova.id).ready(subject)).toThrow(/waiting on them/i)
    expect(ticketOf(ticket.id).column).toBe('planning')
    expect(planOf(subject).status).toBe('waiting')

    engine.planning.approve(planOf(subject).id)

    expect(ticketOf(ticket.id).column).toBe('todo')
    expect(planOf(subject)).toMatchObject({ status: 'approved', approvedBy: BOSS })
  })

  it('Managed: the boss approves the epic’s plan and its tickets inherit it', () => {
    const { engine, nova, subject, ticket, ticketOf, planOf } = drafted('managed', { approved: true })

    employeePlanning(engine, nova.id).ready(subject)

    expect(ticketOf(ticket.id).column).toBe('todo')
    expect(planOf(subject)).toMatchObject({ status: 'approved', approvedBy: nova.id })
  })

  it('Managed: a ticket whose epic has no approved plan still waits on the boss', () => {
    const { engine, nova, subject, ticketOf, ticket } = drafted('managed', { approved: false })

    expect(() => employeePlanning(engine, nova.id).ready(subject)).toThrow(/waiting on them/i)
    expect(ticketOf(ticket.id).column).toBe('planning')
  })

  it('Managed: the epic’s own plan is the boss’s to approve', () => {
    const s = setup()
    s.engine.approvals.setLevel('managed')
    const epic = s.board().createEpic({ title: 'Usage' })
    const subject: PlanSubject = { kind: 'epic', id: epic.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)

    expect(() => employeePlanning(s.engine, s.nova.id).ready(subject)).toThrow(/waiting on them/i)
  })

  it('Autonomous: the planner approves its own plan and posts it', () => {
    const { engine, nova, subject, ticket, ticketOf, planOf } = drafted('autonomous')

    const approved = employeePlanning(engine, nova.id).ready(subject)

    expect(approved).toMatchObject({ status: 'approved', approvedBy: nova.id })
    expect(ticketOf(ticket.id).column).toBe('todo')
    const plan = planOf(subject)
    const thread = engine.chat().read({ channelId: plan.channelId, threadId: plan.threadId! })
    expect(thread.at(-1)!.text).toContain('approved and posted')
  })
})

describe('An approved plan', () => {
  function approved() {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart', repos: [s.web.id] })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, {
      ...DRAFT,
      repos: [s.web.id],
      subtasks: [
        { title: 'from/to on GET /usage', repo: s.web.id },
        { title: 'RangePicker with presets', repo: null },
        { title: 'Nightly job in another repo', repo: 'not-a-repo-of-this-ticket' },
      ],
    })
    s.engine.planning.approve(s.planOf(subject).id)
    return { ...s, ticket, subject }
  }

  it('puts its subtasks on the ticket, keeping the subtask rule', () => {
    const { ticket, ticketOf } = approved()

    expect(ticketOf(ticket.id).subtasks.map((s) => [s.title, s.repo])).toEqual([
      ['from/to on GET /usage', expect.any(String)],
      ['RangePicker with presets', null],
      // The repo is not one of the ticket's, so the subtask keeps the checklist and drops the repo.
      ['Nightly job in another repo', null],
    ])
  })

  it('makes the ticket claimable, and refuses a claim before that', () => {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })

    expect(employeePlanning(s.engine, s.vega.id).claimRefusal(ticket.id)).toMatch(/not Ready/i)

    employeePlanning(s.engine, s.nova.id).draft({ kind: 'ticket', id: ticket.id }, DRAFT)
    s.engine.planning.approve(s.planOf({ kind: 'ticket', id: ticket.id }).id)

    expect(employeePlanning(s.engine, s.vega.id).claimRefusal(ticket.id)).toBeNull()
  })

  it('goes back to the planner when the boss asks for changes', () => {
    const { engine, nova, subject, planOf, inbox } = approved()
    const before = inbox(nova.id).length
    engine.planning.requestChanges(planOf(subject).id, 'Per-seat has to be in v1.')

    expect(planOf(subject).status).toBe('drafting')
    expect(inbox(nova.id).slice(before).at(-1)!.prompt).toContain('Per-seat has to be in v1.')
  })
})

describe('A replan', () => {
  function replanned() {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart', repos: [s.web.id] })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)
    s.engine.planning.approve(s.planOf(subject).id)
    s.board().updateTicket(ticket.id, { assigneeId: s.vega.id })
    s.board().moveTicket(ticket.id, 'doing')
    const next = employeePlanning(s.engine, s.vega.id).replan(ticket.id, 'Scope grew: ranges over 90 days time out.', [
      '+ Subtask · cursor pagination on GET /usage',
    ])
    return { ...s, ticket, subject, next }
  }

  it('sends the ticket back to Planning, keeping its assignee, and pauses the work', () => {
    const { ticket, ticketOf, next, vega } = replanned()

    expect(ticketOf(ticket.id)).toMatchObject({ column: 'planning', assigneeId: vega.id })
    expect(next).toMatchObject({
      version: 2,
      status: 'replan',
      replanBy: vega.id,
      replanReason: 'Scope grew: ranges over 90 days time out.',
      replanChanges: ['+ Subtask · cursor pagination on GET /usage'],
    })
  })

  it('refuses a claim while it waits, and keeps v1 when the boss says Keep v1', () => {
    const { engine, vega, ticket, subject, next, ticketOf, planOf } = replanned()

    expect(employeePlanning(engine, vega.id).claimRefusal(ticket.id)).toMatch(/replanned/i)

    engine.planning.keep(next.id)

    expect(planOf(subject)).toMatchObject({ version: 1, status: 'approved' })
    expect(ticketOf(ticket.id).column).toBe('todo')
  })

  it('is the boss\u2019s to ask for too, from the ticket drawer', () => {
    const s = setup()
    const ticket = s.board().createTicket({ title: 'Usage chart' })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    employeePlanning(s.engine, s.nova.id).draft(subject, DRAFT)
    s.engine.planning.approve(s.planOf(subject).id)

    const next = s.engine.planning.replan(ticket.id, 'The invoice list has to move with it.')

    expect(next).toMatchObject({ version: 2, status: 'replan', replanBy: BOSS })
    expect(s.ticketOf(ticket.id).column).toBe('planning')
    expect(s.inbox(s.nova.id).at(-1)!.prompt).toContain('The invoice list has to move with it.')
  })

  it('or approves v2, which becomes the plan the ticket is worked to', () => {
    const { engine, ticket, subject, next, ticketOf, planOf } = replanned()

    engine.planning.approve(next.id)

    expect(planOf(subject)).toMatchObject({ version: 2, status: 'approved', approvedBy: BOSS })
    expect(ticketOf(ticket.id).column).toBe('todo')
    expect(engine.planning.versions(subject).map((p) => p.version)).toEqual([1, 2])
  })
})

describe('The planning migration', () => {
  it('adds the plan tables and leaves every ticket in the column it was in', () => {
    const db = new DatabaseSync(':memory:')
    const at = migrations.findIndex((m) => m.name === 'planning-plans-and-questions')
    expect(at).toBeGreaterThan(0)
    runMigrations(db, migrations.slice(0, at))
    db.prepare("INSERT INTO ticket (title, column_id, position) VALUES ('Old todo', 'todo', 0)").run()
    db.prepare("INSERT INTO ticket (title, column_id, position) VALUES ('Old done', 'done', 0)").run()

    runMigrations(db, migrations)

    expect(db.prepare('SELECT title, column_id FROM ticket ORDER BY id').all()).toEqual([
      { title: 'Old todo', column_id: 'todo' },
      { title: 'Old done', column_id: 'done' },
    ])
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_question').get()).toEqual({ n: 0 })
    db.close()
  })
})

/** What `planning` looks like to one Employee: the same object its MCP tools are given. */
/**
 * T239: one monorepo called `tinycorp`, a PM, a Tech Lead, a Frontend and a Backend, each engineer
 * with an area inside the one repo. This is the shape the boss dogfoods, and the shape where every
 * ticket used to land on the lead: the seeded Frontend and Backend filters were globs over the repo
 * name, and a monorepo matched neither.
 */
function monorepo() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: '/work/tinycorp', name: 'TinyCorp' })
  const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
  const tess = engine.employees.create({ name: 'Tess', roleId: 'tech-lead' })
  const fran = engine.employees.create({ name: 'Fran', roleId: 'frontend', areas: ['src/renderer/**'] })
  const ben = engine.employees.create({ name: 'Ben', roleId: 'backend', areas: ['src/main/**'] })
  const repo = engine.repos.add({ path: '/code/tinycorp', name: 'tinycorp', stack: readyStack() })
  const board = () => engine.board()
  const ticketOf = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!
  /** A ticket planned by the PM and approved by the boss: what reaching Ready looks like. */
  function ready(title: string, labels: string[]) {
    const ticket = board().createTicket({ title, repos: [repo.id], labels })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    engine.planning.as(pam.id).draft(subject, DRAFT)
    engine.planning.approve(engine.planning.of(subject)!.id)
    return ticketOf(ticket.id)
  }
  return { engine, pam, tess, fran, ben, repo, board, ticketOf, ready }
}

describe('Who a Ready ticket goes to in a monorepo (T239)', () => {
  it('hands renderer work to the Frontend and main-process work to the Backend', () => {
    const { fran, ben, ready } = monorepo()

    expect(ready('The card shows the ticket', ['renderer']).assigneeId).toBe(fran.id)
    expect(ready('The engine keeps the ticket', ['src/main/features/board']).assigneeId).toBe(ben.id)
  })

  it('leaves the ticket where the planner put it, area or no area', () => {
    const { ben, board, repo, ticketOf, engine, pam } = monorepo()
    const ticket = board().createTicket({ title: 'Anything', repos: [repo.id], assigneeId: ben.id })
    const subject: PlanSubject = { kind: 'ticket', id: ticket.id }
    engine.planning.as(pam.id).draft(subject, DRAFT)

    engine.planning.approve(engine.planning.of(subject)!.id)

    expect(ticketOf(ticket.id).assigneeId).toBe(ben.id)
  })

  it('gives it to an engineer whose area is elsewhere before the lead', () => {
    const { tess, fran, ready } = monorepo()

    const assignee = ready('Playwright runs on CI', ['e2e']).assigneeId

    expect(assignee).not.toBe(tess.id)
    expect(assignee).toBe(fran.id)
  })

  it('refuses the lead a ticket an engineer can take, and says who', () => {
    const { engine, tess, ready } = monorepo()
    const ticket = ready('The card shows the ticket', ['renderer'])

    const refusal = engine.planning.as(tess.id).claimRefusal(ticket.id)

    expect(refusal).toMatch(/Fran can take it/)
    expect(engine.planning.as(ticket.assigneeId!).claimRefusal(ticket.id)).toBeNull()
  })

  it('lets the lead claim a ticket the boss handed them, engineer or no engineer', () => {
    const { engine, tess, ready } = monorepo()
    const ticket = ready('The card shows the ticket', ['renderer'])
    engine.board().updateTicket(ticket.id, { assigneeId: tess.id })

    expect(engine.planning.as(tess.id).claimRefusal(ticket.id)).toBeNull()
  })

  it('gives the lead the ticket, and lets them claim it, when no engineer can', () => {
    const { engine, tess, fran, ben, ready } = monorepo()
    engine.employees.update(fran.id, { capabilities: ['review'] })
    engine.employees.update(ben.id, { capabilities: ['review'] })

    const ticket = ready('Nobody else codes here', ['renderer'])

    expect(ticket.assigneeId).toBe(tess.id)
    expect(engine.planning.as(tess.id).claimRefusal(ticket.id)).toBeNull()
  })
})

function employeePlanning(engine: CompanyEngine, employeeId: string) {
  return engine.planning.as(employeeId)
}
