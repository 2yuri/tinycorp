import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** The planning tools as an Employee reaches them: over streamable HTTP, with its own token. */
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
  engine.createCompany({ folder: '/work/acme', name: 'Acme' })
  const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
  const vega = engine.employees.create({ name: 'Vega', roleId: 'backend' })
  const web = engine.repos.add({ path: '/code/web', name: 'web', stack: readyStack() })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    return {
      client,
      async call(name: string, args: Record<string, unknown>) {
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

  const board = () => engine.board()
  const ticketOf = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!
  return { engine, nova, vega, web, board, ticketOf, connectAs }
}

describe('Planning over MCP', () => {
  it('lists the planning tools', async () => {
    const { nova, connectAs } = await setup()
    const { client } = await connectAs(nova.id)

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['plan_ask', 'plan_draft', 'plan_ready', 'plan_replan']),
    )
  })

  it('asks, drafts and reaches Ready once the boss approves', async () => {
    const { engine, nova, web, board, ticketOf, connectAs } = await setup()
    const ticket = board().createTicket({ title: 'Usage chart', repos: [web.id] })
    const planner = await connectAs(nova.id)

    const asked = await planner.call('plan_ask', {
      ticket_id: `AC-${ticket.id}`,
      questions: ['Which ranges?', 'Totals only?'],
    })
    expect(asked.json().questions).toMatchObject([
      { number: 1, answer: null },
      { number: 2, answer: null },
    ])

    const plan = engine.planning.of({ kind: 'ticket', id: ticket.id })!
    engine.planning.answer(plan.questions[0]!.id, '7, 30, 90 and custom.')
    engine.planning.delegate(plan.questions[1]!.id)

    const drafted = await planner.call('plan_draft', {
      ticket_id: ticket.id,
      goal: 'Customers see what they used over a chosen range.',
      approach: 'from/to on GET /usage and a RangePicker.',
      acceptance_criteria: ['7d, 30d, 90d and custom'],
      repos: ['web'],
      subtasks: [{ title: 'RangePicker', repo: 'web' }],
      risks: ['Long ranges hit the nightly aggregate'],
      open_questions: ['Assumed the range goes in the URL'],
    })
    expect(drafted.json()).toMatchObject({ status: 'waiting', version: 1, repos: ['web'] })

    const refused = await planner.call('plan_ready', { ticket_id: ticket.id })
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/waiting on them/i) })
    expect(ticketOf(ticket.id).column).toBe('planning')

    engine.planning.approve(engine.planning.of({ kind: 'ticket', id: ticket.id })!.id)

    expect(ticketOf(ticket.id)).toMatchObject({ column: 'todo' })
    expect(ticketOf(ticket.id).subtasks.map((s) => s.title)).toEqual(['RangePicker'])
  })

  it('refuses ticket_claim while the ticket is not Ready', async () => {
    const { board, vega, connectAs } = await setup()
    const ticket = board().createTicket({ title: 'Usage chart' })
    const engineer = await connectAs(vega.id)

    const claimed = await engineer.call('ticket_claim', { ticket_id: ticket.id })

    expect(claimed).toMatchObject({
      isError: true,
      text: expect.stringMatching(/in Planning, not Ready/i),
    })
  })

  it('sends a ticket back to Planning on a replan, and says so to the boss', async () => {
    const { engine, nova, vega, board, ticketOf, connectAs } = await setup()
    const ticket = board().createTicket({ title: 'Usage chart' })
    const planner = await connectAs(nova.id)
    await planner.call('plan_draft', { ticket_id: ticket.id, goal: 'A range picker', approach: 'Two fields.' })
    engine.planning.approve(engine.planning.of({ kind: 'ticket', id: ticket.id })!.id)
    board().updateTicket(ticket.id, { assigneeId: vega.id })
    board().moveTicket(ticket.id, 'doing')
    const engineer = await connectAs(vega.id)

    const replanned = await engineer.call('plan_replan', {
      ticket_id: `AC-${ticket.id}`,
      reason: 'Scope grew: ranges over 90 days time out.',
      changes: ['+ Subtask · cursor pagination on GET /usage'],
    })

    expect(replanned.json()).toMatchObject({ version: 2, status: 'replan', column: 'planning' })
    expect(ticketOf(ticket.id)).toMatchObject({ column: 'planning', assigneeId: vega.id })
    const posted = engine.chat().read({ channelId: 'general' }).at(-1)!
    expect(posted.text).toContain('Scope grew')
    expect(posted.mentions).toContain(BOSS)
  })

  it('plans an epic, whose tickets then go Ready on their own under Managed', async () => {
    const { engine, nova, board, ticketOf, connectAs } = await setup()
    const epic = board().createEpic({ title: 'Usage' })
    const planner = await connectAs(nova.id)
    await planner.call('plan_draft', { epic_id: epic.id, goal: 'Usage, end to end', approach: 'Three tickets.' })
    engine.planning.approve(engine.planning.of({ kind: 'epic', id: epic.id })!.id)

    const ticket = board().createTicket({ title: 'Usage chart', epicId: epic.id })
    await planner.call('plan_draft', { ticket_id: ticket.id, goal: 'A chart', approach: 'Recharts.' })
    const ready = await planner.call('plan_ready', { ticket_id: ticket.id })

    expect(ready.json()).toMatchObject({ status: 'approved', approved_by: 'Nova' })
    expect(ticketOf(ticket.id).column).toBe('todo')
  })
})
