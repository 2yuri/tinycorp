import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const node = { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' }

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

describe('Ticket extras over MCP', () => {
  it('creates a ticket with a priority, labels and a base branch, and board_list returns them', async () => {
    const { ada, connectAs, ticket } = await setup()
    const employee = await connectAs(ada.id)

    const created = await employee.call('ticket_create', {
      title: 'Checkout fails when the card token expires',
      repos: ['web'],
      priority: 'high',
      labels: ['bug', 'checkout', 'p1'],
      base_branch: 'release/2.0',
    })
    const listed = (await employee.call('board_list')).json()

    expect(created.json()).toMatchObject({
      priority: 'high',
      labels: ['bug', 'checkout', 'p1'],
      base_branch: 'release/2.0',
    })
    expect(listed.tickets).toEqual([
      expect.objectContaining({ priority: 'high', labels: ['bug', 'checkout', 'p1'], base_branch: 'release/2.0' }),
    ])
    expect(ticket(created.json().number)).toMatchObject({ priority: 'high', baseBranch: 'release/2.0' })
  })

  it('lists defaults for a plain ticket and the colour of each epic', async () => {
    const { engine, ada, connectAs } = await setup()
    engine.board().createEpic({ title: 'Billing' })
    engine.board().createEpic({ title: 'Infra', color: 'amber' })
    const employee = await connectAs(ada.id)

    await employee.call('ticket_create', { title: 'Plain' })
    const listed = (await employee.call('board_list')).json()

    expect(listed.tickets).toEqual([expect.objectContaining({ priority: 'normal', labels: [], base_branch: null })])
    expect(listed.epics.map((e: { color: string }) => e.color)).toEqual(['indigo', 'amber'])
  })

  it('creates an epic with a chosen colour and refuses one outside the palette', async () => {
    const { ada, connectAs, board } = await setup()
    const employee = await connectAs(ada.id)

    const red = await employee.call('epic_create', { title: 'Hotfixes', color: 'red' })
    const pink = await employee.call('epic_create', { title: 'Pink', color: 'pink' })

    expect(red.json()).toMatchObject({ color: 'red' })
    expect(pink.isError).toBe(true)
    expect(board().epics.map((e) => e.color)).toEqual(['red'])
  })

  it('updates priority, labels and base branch, keeps them when omitted, and clears the base with null', async () => {
    const { engine, ada, connectAs, ticket } = await setup()
    const { id } = engine.board().createTicket({ title: 'Fix', labels: ['bug'], baseBranch: 'develop' })
    const employee = await connectAs(ada.id)

    const raised = await employee.call('ticket_update', { ticket_id: id, priority: 'urgent', labels: ['bug', 'p0'] })
    const renamed = await employee.call('ticket_update', { ticket_id: id, title: 'Fix it' })
    const cleared = await employee.call('ticket_update', { ticket_id: id, base_branch: null })

    expect(raised.json()).toMatchObject({ priority: 'urgent', labels: ['bug', 'p0'], base_branch: 'develop' })
    expect(renamed.json()).toMatchObject({ priority: 'urgent', labels: ['bug', 'p0'], base_branch: 'develop' })
    expect(cleared.json()).toMatchObject({ base_branch: null })
    expect(ticket(id)).toMatchObject({ title: 'Fix it', priority: 'urgent', baseBranch: null })
  })

  it('refuses an unknown priority and a bad branch name, and changes nothing', async () => {
    const { engine, ada, connectAs, ticket, board } = await setup()
    const { id } = engine.board().createTicket({ title: 'Fix' })
    const employee = await connectAs(ada.id)

    const priority = await employee.call('ticket_update', { ticket_id: id, priority: 'asap' })
    const branch = await employee.call('ticket_update', { ticket_id: id, title: 'Renamed', base_branch: 'bad name' })
    const created = await employee.call('ticket_create', { title: 'New', base_branch: '..' })

    expect(priority.isError).toBe(true)
    expect(branch).toMatchObject({ isError: true, text: expect.stringContaining('not a valid branch name') })
    expect(created.isError).toBe(true)
    expect(ticket(id)).toMatchObject({ title: 'Fix', priority: 'normal', baseBranch: null })
    expect(board().tickets).toHaveLength(1)
  })

  it('describes the new fields in the tool schemas', async () => {
    const { ada, connectAs } = await setup()
    const { client } = await connectAs(ada.id)

    const { tools } = await client.listTools()
    const props = (name: string) =>
      Object.keys((tools.find((t) => t.name === name)!.inputSchema as { properties: object }).properties)

    expect(props('ticket_create')).toEqual(expect.arrayContaining(['priority', 'labels', 'base_branch']))
    expect(props('ticket_update')).toEqual(expect.arrayContaining(['priority', 'labels', 'base_branch']))
    expect(props('epic_create')).toContain('color')
  })
})
