import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityKind } from '../../../shared/activity'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

/** A Company with a git service, Ada on staff and one repo, so every flow can run. */
function setup({ reviewer = false }: { reviewer?: boolean } = {}) {
  const provider = fakeProvider()
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = reviewer ? engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] }) : null
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  /** The log in the order it happened, oldest first: a flow's events read as a story. */
  const story = () => [...engine.activity.list({ limit: 500 })].reverse()
  const of = (kind: ActivityKind) => story().filter((event) => event.kind === kind)

  return { engine, acme, git, ada, rev, web, callerFor, story, of }
}

describe('what the board writes to the activity log', () => {
  it('records a ticket created, assigned, moved and closed, with the Company key', () => {
    const { engine, ada, of } = setup()

    const ticket = engine.board().createTicket({ title: 'Login page' })
    engine.board().updateTicket(ticket.id, { assigneeId: ada.id })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'done')

    expect(of('ticket_created')[0]).toMatchObject({
      actorId: BOSS,
      actorName: 'Boss',
      summary: `created AC-${ticket.id}`,
      subject: { kind: 'ticket', id: `${ticket.id}`, label: `AC-${ticket.id}` },
      detail: 'Login page',
    })
    expect(of('ticket_assigned')[0]).toMatchObject({ summary: `assigned AC-${ticket.id} to Ada` })
    expect(of('ticket_moved').map((e) => e.summary)).toEqual([
      `moved AC-${ticket.id} to Doing`,
      `closed AC-${ticket.id}`,
    ])
  })

  it('records an Employee’s own board move under that Employee', () => {
    const { engine, ada, callerFor, of } = setup()

    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id })
    callerFor(ada.id).board.moveTicket(ticket.id, 'doing')

    expect(of('ticket_moved')[0]).toMatchObject({ actorId: ada.id, actorName: 'Ada' })
  })

  it('records an epic', () => {
    const { engine, of } = setup()

    engine.board().createEpic({ title: 'Checkout' })

    expect(of('epic_created')[0]).toMatchObject({ actorId: BOSS, summary: 'created the epic Checkout' })
  })
})

describe('what chat writes to the activity log', () => {
  it('records that a post happened, never what it said', () => {
    const { engine, ada, of } = setup()

    engine.chat().post({ authorId: ada.id, channelId: 'general', text: 'Standing up the login page today' })

    const [event] = of('message_posted')
    expect(event).toMatchObject({
      actorId: ada.id,
      actorName: 'Ada',
      summary: 'posted in #general',
      subject: { kind: 'channel', id: 'general', label: '#general' },
      detail: null,
    })
    expect(JSON.stringify(event)).not.toContain('login page')
  })

  it('records a direct message by who it went to, not by its text', () => {
    const { engine, ada, of } = setup()

    engine.chat().post({ authorId: BOSS, channelId: `dm:${[BOSS, ada.id].sort().join(':')}`, text: 'hi' })

    expect(of('message_posted')[0]).toMatchObject({ actorId: BOSS, summary: 'sent Ada a direct message' })
  })
})

describe('what approvals and hiring write to the activity log', () => {
  it('records a gated request and the boss’s decision', () => {
    const { engine, ada, of } = setup()

    const outcome = engine.approvals.request({
      requesterId: ada.id,
      action: 'merge',
      ticketId: engine.board().createTicket({ title: 'Login page' }).id,
      reason: 'CI is green.',
    })
    if (outcome.gate !== 'ask') throw new Error('Managed should ask')
    engine.approvals.decide(outcome.approval.id, { approve: true })

    expect(of('approval_requested')[0]).toMatchObject({
      actorId: ada.id,
      summary: 'asked to merge AC-1 Login page',
      detail: 'CI is green.',
      badge: { label: 'Pending', tone: 'warning' },
    })
    expect(of('approval_decided')[0]).toMatchObject({ actorId: BOSS, summary: 'approved AC-1 Login page' })
  })

  it('records a hire proposal and the hire the approval carried out', () => {
    const { engine, ada, of } = setup()
    engine.employees.update(ada.id, { capabilities: ['hire'] })

    const outcome = engine.hiring.requestHire({
      requesterId: ada.id,
      role: 'frontend',
      reason: 'Two tickets are waiting on the UI.',
    })
    if (outcome.status !== 'pending') throw new Error('Managed should ask')
    engine.approvals.decide(outcome.approvalId, { approve: true })

    expect(of('hire_proposed')[0]).toMatchObject({
      actorId: ada.id,
      summary: expect.stringMatching(/^proposed hiring /),
      badge: { label: 'Pending', tone: 'warning' },
    })
    expect(of('employee_hired')[0]).toMatchObject({
      actorId: ada.id,
      summary: expect.stringMatching(/^hired /),
      subject: { kind: 'employee' },
    })
  })

  it('records the boss firing an Employee, keeping their name', () => {
    const { engine, ada, of } = setup()

    engine.hiring.fire(ada.id, 'The work moved on')

    expect(of('employee_fired')[0]).toMatchObject({
      actorId: BOSS,
      summary: 'let Ada go',
      subject: { kind: 'employee', id: ada.id, label: 'Ada' },
    })
  })
})

describe('what the code flow and reviews write to the activity log', () => {
  it('records the worktree, the PR, the review request, the verdict and the merge', async () => {
    const { engine, ada, rev, web, of } = setup({ reviewer: true })

    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    expect(of('worktree_opened')[0]).toMatchObject({
      actorId: ada.id,
      summary: expect.stringContaining('opened a worktree from'),
      subject: { kind: 'ticket', label: `AC-${ticket.id}` },
    })

    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(of('pull_request_opened')).toHaveLength(1))
    expect(of('pull_request_opened')[0]).toMatchObject({
      actorId: ada.id,
      summary: expect.stringMatching(/^opened a pull request in web/),
      badge: { label: 'Needs review', tone: 'primary' },
    })

    await vi.waitFor(() => expect(of('review_requested')).toHaveLength(1))
    expect(of('review_requested')[0]).toMatchObject({
      actorId: ada.id,
      summary: `asked Rev to review AC-${ticket.id}`,
    })

    engine.reviews.approve(ticket.id)
    expect(of('review_submitted')[0]).toMatchObject({ actorId: BOSS, summary: `approved AC-${ticket.id}` })
    await vi.waitFor(() => expect(of('merged')).toHaveLength(1))
    expect(of('merged')[0]).toMatchObject({
      summary: `merged AC-${ticket.id} in web`,
      badge: { label: 'Merged', tone: 'success' },
    })
    expect(rev).not.toBeNull()
  })
})

describe('what Sessions, repos and capacity write to the activity log', () => {
  it('records a Session starting and stopping', async () => {
    const { engine, ada, of } = setup()

    engine.sessions.start(ada.id)
    await vi.waitFor(() => expect(of('session_started')).toHaveLength(1))
    engine.sessions.stop(ada.id)

    expect(of('session_started')[0]).toMatchObject({
      actorId: ada.id,
      summary: 'started their Session',
      subject: { kind: 'session', id: ada.id, label: 'Ada' },
    })
    expect(of('session_stopped')[0]).toMatchObject({ actorId: ada.id, summary: 'stopped their Session' })
  })

  it('records a connected repository', () => {
    const { of } = setup()

    expect(of('repo_connected')[0]).toMatchObject({
      actorId: BOSS,
      summary: 'connected repository web',
      subject: { kind: 'repo', label: 'web' },
    })
  })

  it('records a change to the concurrency cap', () => {
    const { engine, of } = setup()

    engine.capacity.setConcurrencyCap(2)

    expect(of('concurrency_cap_changed')[0]).toMatchObject({
      actorId: BOSS,
      summary: 'set the concurrency cap to 2',
    })
  })
})

describe('reading the log', () => {
  it('filters by kind group and by Employee, newest first', () => {
    const { engine, ada, of } = setup()

    const ticket = engine.board().createTicket({ title: 'Login page' })
    engine.chat().post({ authorId: ada.id, channelId: 'general', text: 'on it' })

    expect(engine.activity.list({ groups: ['tickets'] }).map((e) => e.kind)).toEqual(['ticket_created'])
    expect(engine.activity.list({ actorId: ada.id }).map((e) => e.kind)).toEqual(['message_posted'])
    expect(engine.activity.list({ search: `AC-${ticket.id}` }).map((e) => e.kind)).toEqual(['ticket_created'])
    expect(engine.activity.actors().map((a) => a.name)).toEqual(['Ada', 'Boss'])
    expect(of('ticket_created')).toHaveLength(1)
  })

  it('tells listeners an event landed', () => {
    const { engine } = setup()
    let changes = 0
    engine.activity.onChange(() => changes++)

    engine.board().createTicket({ title: 'Login page' })

    expect(changes).toBeGreaterThan(0)
  })
})

describe('what still reads the same events', () => {
  it('keeps the office’s chat posts and the notification of a mention (decision 36)', () => {
    const { engine, acme, ada } = setup()
    const notifications: string[] = []
    engine.notifications.onNotify((notification) => void notifications.push(notification.title))

    const message = engine.chat().post({ authorId: ada.id, channelId: 'general', text: 'hey @boss' })

    expect(engine.office.facts().activity[ada.id]?.posts).toEqual([expect.objectContaining({ channelId: 'general' })])
    expect(engine.activity.list({ groups: ['people'] })[0]).toMatchObject({ kind: 'message_posted' })
    expect(message.mentions).toContain(BOSS)
    expect(acme.id).toBeTruthy()
  })
})
