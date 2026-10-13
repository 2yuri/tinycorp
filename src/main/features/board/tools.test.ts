import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const node = readyStack()

async function setup() {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace Holt', roleId: 'tech-lead' })
  const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
  const api = engine.repos.add({ path: onDisk('/code/api'), stack: node })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    return connect(url, token)
  }
  const board = () => engine.board().snapshot()
  const ticket = (id: number) => board().tickets.find((t) => t.id === id)!
  return { engine, ada, grace, web, api, connectAs, board, ticket }
}

async function connect(url: string, token: string) {
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
  cleanups.push(() => client.close())
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { type: string; text: string }[]
      }
      const text = result.content.map((c) => c.text).join('')
      // biome-ignore lint/suspicious/noExplicitAny: an MCP tool answers JSON with no static shape; the assertions below are the check
      return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as any }
    },
  }
}

describe('Board tools over MCP', () => {
  it('lists every board tool', async () => {
    const { ada, connectAs } = await setup()
    const { client } = await connectAs(ada.id)

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'board_list',
        'ticket_create',
        'ticket_claim',
        'ticket_move',
        'ticket_update',
        'ticket_blocked_by',
        'subtask_toggle',
        'target_create',
        'epic_create',
      ]),
    )
  })

  it('builds a target, an epic with its channel, and tickets in it', async () => {
    const { engine, ada, grace, board, connectAs } = await setup()
    const pm = await connectAs(ada.id)

    const target = (await pm.call('target_create', { title: 'Magic link login' })).json()
    const epic = await pm.call('epic_create', {
      title: 'Login',
      target_id: target.id,
      members: ['Grace Holt'],
    })
    const ticket = await pm.call('ticket_create', {
      title: 'Email sender',
      epic_id: epic.json().id,
      repos: ['api'],
    })

    expect(epic.json()).toEqual({
      id: expect.any(Number),
      title: 'Login',
      description: '',
      target_id: target.id,
      color: 'indigo',
      channel: `#epic-${epic.json().id}-login`,
    })
    expect(ticket.json()).toMatchObject({ title: 'Email sender', column: 'planning', repos: ['api'] })
    // Decision 33: a ticket answers with its display id, and the number behind it.
    expect(ticket.json()).toMatchObject({ id: `AC-${ticket.json().number as number}` })
    expect(board()).toMatchObject({
      targets: [{ id: target.id, title: 'Magic link login' }],
      epics: [{ id: epic.json().id, targetId: target.id }],
      tickets: [{ id: ticket.json().number, epicId: epic.json().id }],
    })
    expect(
      engine
        .chat()
        .channels()
        .find((c) => c.id === `epic-${epic.json().id}-login`)?.members,
    ).toEqual([ada.id, grace.id])
  })

  it('records a target’s due day, and hangs it under the message that announces it (T151)', async () => {
    const { engine, ada, connectAs } = await setup()
    const pm = await connectAs(ada.id)

    const target = (await pm.call('target_create', { title: 'Billing dashboard', due: '2026-09-18' })).json()
    expect(target).toMatchObject({ title: 'Billing dashboard', dueAt: '2026-09-18' })

    await pm.call('chat_post', { channel: '#general', text: 'One target, two epics.', target_id: target.id })
    expect(engine.chat().read({ channelId: 'general' }).at(-1)).toMatchObject({ targetId: target.id })
  })

  it('lists the board with names, and only the caller’s tickets on request', async () => {
    const { engine, ada, grace, web, connectAs } = await setup()
    engine.board().setWipLimit('doing', 1)
    const epic = engine.board().createEpic({ title: 'Login' })
    engine.board().createTicket({ title: 'Mine', column: 'todo', assigneeId: ada.id, repos: [web.id], epicId: epic.id })
    engine.board().createTicket({ title: 'Theirs', assigneeId: grace.id, column: 'doing' })
    const employee = await connectAs(ada.id)

    const all = (await employee.call('board_list')).json()
    const mine = (await employee.call('board_list', { mine: true })).json()
    const doing = (await employee.call('board_list', { column: 'doing' })).json()

    expect(all.columns).toEqual([
      { column: 'planning', title: 'Planning', count: 0, wip_limit: null, over_limit: false },
      { column: 'todo', title: 'Ready', count: 1, wip_limit: null, over_limit: false },
      { column: 'doing', title: 'Doing', count: 1, wip_limit: 1, over_limit: false },
      { column: 'review', title: 'Review', count: 0, wip_limit: null, over_limit: false },
      { column: 'testing', title: 'Testing', count: 0, wip_limit: null, over_limit: false },
      { column: 'done', title: 'Done', count: 0, wip_limit: null, over_limit: false },
    ])
    expect(all.epics).toEqual([expect.objectContaining({ id: epic.id, channel: `#epic-${epic.id}-login` })])
    expect(all.tickets).toEqual([
      expect.objectContaining({ title: 'Mine', assignee: 'Ada', repos: ['web'], epic_id: epic.id }),
      expect.objectContaining({ title: 'Theirs', assignee: 'Grace Holt', column: 'doing' }),
    ])
    expect(mine.tickets.map((t: { title: string }) => t.title)).toEqual(['Mine'])
    expect(doing.tickets.map((t: { title: string }) => t.title)).toEqual(['Theirs'])
  })

  it('assigns a new ticket by name and wakes the assignee', async () => {
    const { engine, ada, grace, connectAs } = await setup()
    const lead = await connectAs(grace.id)

    const created = await lead.call('ticket_create', {
      title: 'Signup API',
      assignee: 'ada',
      repos: ['api'],
      subtasks: [{ title: 'route' }, { title: 'tests', repo: 'api', assignee: 'Ada' }],
    })

    expect(created.json()).toMatchObject({
      assignee: 'Ada',
      subtasks: [
        { title: 'route', done: false, repo: null },
        { title: 'tests', done: false, repo: 'api' },
      ],
    })
    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ kind: 'assigned', fromId: grace.id, ticketId: created.json().number }),
    ])
  })

  it('refuses a subtask for another person or another repo, and creates nothing', async () => {
    const { ada, board, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const otherPerson = await employee.call('ticket_create', {
      title: 'Signup',
      assignee: 'Ada',
      subtasks: [{ title: 'design', assignee: 'Grace Holt' }],
    })
    const otherRepo = await employee.call('ticket_create', {
      title: 'Signup',
      repos: ['api'],
      subtasks: [{ title: 'form', repo: 'web' }],
    })

    expect(otherPerson).toMatchObject({ isError: true, text: expect.stringMatching(/make it a ticket/i) })
    expect(otherRepo).toMatchObject({ isError: true, text: expect.stringMatching(/make it a ticket/i) })
    expect(board().tickets).toEqual([])
  })

  it('claims a free ticket into Doing, without waking the claimer', async () => {
    const { engine, ada, ticket, connectAs } = await setup()
    const free = engine.board().createTicket({ title: 'Free', column: 'todo' })
    const employee = await connectAs(ada.id)

    const claimed = await employee.call('ticket_claim', { ticket_id: free.id })
    const again = await employee.call('ticket_claim', { ticket_id: free.id })

    expect(claimed.json()).toMatchObject({ id: `AC-${free.id}`, number: free.id, assignee: 'Ada', column: 'doing' })
    expect(again.isError).toBe(false)
    expect(ticket(free.id)).toMatchObject({ assigneeId: ada.id, column: 'doing' })
    expect(engine.inbox.list(ada.id)).toEqual([])
  })

  // T266: a planning Employee splitting an epic records its order through the same board.
  it('adds and removes a blocker, and reads it back on both tickets', async () => {
    const { engine, grace, ticket, connectAs } = await setup()
    const card = engine.board().createTicket({ title: 'Retry a failed charge', column: 'todo' })
    const token = engine.board().createTicket({ title: 'Refresh the card token', column: 'todo' })
    const lead = await connectAs(grace.id)

    const added = await lead.call('ticket_blocked_by', { ticket_id: `AC-${card.id}`, blocked_by: `AC-${token.id}` })
    const listed = await lead.call('board_list')

    expect(added.json()).toMatchObject({ blocked_by: [`AC-${token.id}`], blocks: [], waits: true })
    expect(listed.json().tickets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: `AC-${token.id}`, blocks: [`AC-${card.id}`] })]),
    )

    const removed = await lead.call('ticket_blocked_by', { ticket_id: card.id, blocked_by: token.id, remove: true })
    expect(removed.json()).toMatchObject({ blocked_by: [], waits: false })
    expect(ticket(card.id).blockedBy).toEqual([])
  })

  it('refuses a blocker that would loop, and one from another Company', async () => {
    const { engine, grace, ticket, connectAs } = await setup()
    const a = engine.board().createTicket({ title: 'One', column: 'todo' })
    const b = engine.board().createTicket({ title: 'Two', column: 'todo' })
    engine.board().addBlocker(a.id, b.id)
    const lead = await connectAs(grace.id)

    const loop = await lead.call('ticket_blocked_by', { ticket_id: b.id, blocked_by: a.id })
    const foreign = await lead.call('ticket_blocked_by', { ticket_id: b.id, blocked_by: 'TC-1' })

    expect(loop).toMatchObject({
      isError: true,
      text: `AC-${a.id} already waits on AC-${b.id} — that would be a loop.`,
    })
    expect(foreign).toMatchObject({ isError: true, text: expect.stringMatching(/not a ticket of this Company/) })
    expect(ticket(b.id).blockedBy).toEqual([])
  })

  it('refuses to claim a ticket that waits, and takes nothing', async () => {
    const { engine, ada, ticket, connectAs } = await setup()
    const card = engine.board().createTicket({ title: 'Retry a failed charge', column: 'todo' })
    const token = engine.board().createTicket({ title: 'Refresh the card token', column: 'todo' })
    engine.board().addBlocker(card.id, token.id)
    const employee = await connectAs(ada.id)

    const claimed = await employee.call('ticket_claim', { ticket_id: card.id })

    expect(claimed).toMatchObject({ isError: true, text: expect.stringContaining(`waits on AC-${token.id}`) })
    expect(ticket(card.id)).toMatchObject({ assigneeId: null, column: 'todo' })
  })

  // Decision 33: the display id is what an Employee reads everywhere, so every tool takes it back.
  it('takes a ticket named by its display id, its short form or its number', async () => {
    const { engine, ada, ticket, connectAs } = await setup()
    const free = engine.board().createTicket({ title: 'Free', column: 'todo' })
    const employee = await connectAs(ada.id)

    const claimed = await employee.call('ticket_claim', { ticket_id: `AC-${free.id}` })
    const moved = await employee.call('ticket_move', { ticket_id: `#${free.id}`, column: 'todo' })
    const updated = await employee.call('ticket_update', { ticket_id: free.id, description: 'By number' })
    const wrong = await employee.call('ticket_claim', { ticket_id: 'the login one' })

    expect(claimed.json()).toMatchObject({ id: `AC-${free.id}`, column: 'doing' })
    expect(moved.json()).toMatchObject({ id: `AC-${free.id}`, column: 'todo' })
    expect(updated.json()).toMatchObject({ description: 'By number' })
    expect(ticket(free.id)).toMatchObject({ description: 'By number' })
    expect(wrong).toMatchObject({ isError: true, text: expect.stringMatching(/write it as TC-142 or 142/i) })
  })

  it('claims and works a ticket in a repo without checks', async () => {
    const { engine, ada, web, ticket, connectAs } = await setup()
    engine.repos.update(web.id, { stack: { install: '', build: '', test: '', lint: '' } })
    const free = engine.board().createTicket({ title: 'Scaffold', column: 'todo', repos: [web.id] })
    const employee = await connectAs(ada.id)

    const claimed = await employee.call('ticket_claim', { ticket_id: free.id })
    const updated = await employee.call('ticket_update', { ticket_id: free.id, description: 'Vite + React' })

    expect(claimed.isError).toBe(false)
    expect(updated.isError).toBe(false)
    expect(ticket(free.id)).toMatchObject({ assigneeId: ada.id, column: 'doing', description: 'Vite + React' })
  })

  it('refuses to claim a ticket someone else holds', async () => {
    const { engine, ada, grace, ticket, connectAs } = await setup()
    const held = engine.board().createTicket({ title: 'Held', column: 'todo', assigneeId: grace.id })
    const employee = await connectAs(ada.id)

    const result = await employee.call('ticket_claim', { ticket_id: held.id })

    expect(result).toMatchObject({ isError: true, text: expect.stringMatching(/Grace Holt holds/) })
    expect(ticket(held.id)).toMatchObject({ assigneeId: grace.id, column: 'todo' })
  })

  it('moves a ticket to a column and position', async () => {
    const { engine, ada, board, connectAs } = await setup()
    const first = engine.board().createTicket({ title: 'First', column: 'review' })
    const moved = engine.board().createTicket({ title: 'Moved' })
    const employee = await connectAs(ada.id)

    const result = await employee.call('ticket_move', { ticket_id: moved.id, column: 'review', position: 0 })

    expect(result.json()).toMatchObject({ id: `AC-${moved.id}`, column: 'review' })
    expect(board().tickets.map((t) => t.id)).toEqual([moved.id, first.id])
  })

  it('updates a ticket, waking a new assignee and keeping the subtask rule', async () => {
    const { engine, ada, grace, ticket, connectAs } = await setup()
    const own = engine.board().createTicket({ title: 'Own', column: 'todo', assigneeId: ada.id })
    const employee = await connectAs(ada.id)

    const updated = await employee.call('ticket_update', {
      ticket_id: own.id,
      title: 'Own it',
      repos: ['web'],
      blocked: true,
      blocked_reason: 'waiting on keys',
      add_subtasks: [{ title: 'form', repo: 'web' }],
    })
    const refused = await employee.call('ticket_update', {
      ticket_id: own.id,
      add_subtasks: [{ title: 'server', repo: 'api' }],
    })
    const handedOver = await employee.call('ticket_update', { ticket_id: own.id, assignee: 'Grace Holt' })

    expect(updated.json()).toMatchObject({
      title: 'Own it',
      repos: ['web'],
      blocked: true,
      blocked_reason: 'waiting on keys',
      subtasks: [{ title: 'form', repo: 'web' }],
    })
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/make it a ticket/i) })
    expect(ticket(own.id).subtasks).toHaveLength(1)
    expect(handedOver.json()).toMatchObject({ assignee: 'Grace Holt' })
    expect(engine.inbox.list(grace.id)).toEqual([
      expect.objectContaining({ kind: 'assigned', fromId: ada.id, ticketId: own.id }),
    ])
  })

  it('unassigns a ticket with a null assignee', async () => {
    const { engine, ada, ticket, connectAs } = await setup()
    const own = engine.board().createTicket({ title: 'Own', column: 'todo', assigneeId: ada.id })
    const employee = await connectAs(ada.id)

    await employee.call('ticket_update', { ticket_id: own.id, assignee: null })

    expect(ticket(own.id).assigneeId).toBeNull()
  })

  it('toggles a subtask of the caller’s ticket, but not of someone else’s', async () => {
    const { engine, ada, grace, ticket, connectAs } = await setup()
    const own = engine.board().createTicket({ title: 'Own', column: 'todo', assigneeId: ada.id })
    const step = engine.board().createSubtask({ ticketId: own.id, title: 'step' })
    const theirs = engine.board().createTicket({ title: 'Theirs', column: 'todo', assigneeId: grace.id })
    const their = engine.board().createSubtask({ ticketId: theirs.id, title: 'their step' })
    const employee = await connectAs(ada.id)

    const toggled = await employee.call('subtask_toggle', { subtask_id: step.id })
    const set = await employee.call('subtask_toggle', { subtask_id: step.id, done: true })
    const refused = await employee.call('subtask_toggle', { subtask_id: their.id })

    expect(toggled.json()).toMatchObject({ id: step.id, done: true, ticket: `AC-${own.id}` })
    expect(set.json()).toMatchObject({ done: true })
    expect(ticket(own.id).subtasks[0]).toMatchObject({ done: true })
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/make it a ticket/i) })
    expect(ticket(theirs.id).subtasks[0]).toMatchObject({ done: false })
  })

  it('reports unknown tickets, people, repos and subtasks as tool errors', async () => {
    const { ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const results = await Promise.all([
      employee.call('ticket_claim', { ticket_id: 404 }),
      employee.call('ticket_create', { title: 'x', assignee: 'Nobody' }),
      employee.call('ticket_create', { title: 'x', repos: ['mobile'] }),
      employee.call('subtask_toggle', { subtask_id: 404 }),
      employee.call('epic_create', { title: 'x', members: ['Nobody'] }),
      employee.call('ticket_create', { title: 'x', assignee: 'boss' }),
    ])

    expect(results.map((r) => r.isError)).toEqual([true, true, true, true, true, true])
    expect(results.map((r) => r.text)).toEqual([
      expect.stringMatching(/no ticket AC-404/i),
      expect.stringMatching(/nobody is called Nobody/i),
      expect.stringMatching(/no repo mobile/i),
      expect.stringMatching(/no subtask 404/i),
      expect.stringMatching(/nobody is called Nobody/i),
      expect.stringMatching(/only Employees hold tickets/i),
    ])
  })

  it('wakes a ticket’s holder when another Employee references it in chat', async () => {
    const { engine, ada, grace, connectAs } = await setup()
    const employee = await connectAs(ada.id)
    const created = (await employee.call('ticket_create', { title: 'Mine', assignee: 'Ada' })).json()
    const epic = (await employee.call('epic_create', { title: 'Login' })).json()
    const lead = await connectAs(grace.id)

    await lead.call('chat_post', { channel: '#tech', text: `how is #${created.id}?` })
    await lead.call('chat_post', { channel: epic.channel, text: 'kickoff at 3' })

    expect(engine.inbox.list(ada.id).map((i) => [i.kind, i.fromId])).toEqual([
      ['ticket', grace.id],
      ['epic', grace.id],
    ])
    // Grace holds `plan`, so Ada's new ticket and epic wait in Planning for her (T171).
    expect(engine.inbox.list(grace.id).map((i) => i.kind)).toEqual(['planning', 'planning'])
  })
})
