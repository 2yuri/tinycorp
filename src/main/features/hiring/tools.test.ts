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
  const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
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
        return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
      },
    }
  }
  return { engine, provider, pam, ada, connectAs }
}

describe('team_load over MCP', () => {
  it('returns WIP per Employee, unassigned tickets and skill gaps, by name', async () => {
    const { engine, pam, ada, connectAs } = await setup()
    const web = engine.repos.add({
      path: onDisk('/code/web'),
      stack: { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' },
    })
    const board = engine.board()
    board.createTicket({ title: 'API', assigneeId: ada.id })
    board.createTicket({ title: 'Landing page', column: 'todo', repos: [web.id] })
    const employee = await connectAs(pam.id)

    const result = await employee.call('team_load')

    expect(result.isError).toBe(false)
    const load = result.json()
    expect(load['employees']).toEqual([
      expect.objectContaining({ name: 'Pam', title: 'PM', wip: 0 }),
      expect.objectContaining({
        name: 'Ada',
        title: 'Backend',
        wip: 1,
        tickets: [expect.objectContaining({ title: 'API' })],
      }),
    ])
    expect(JSON.stringify(load['employees'])).not.toContain(ada.id)
    expect(load['unassigned']).toEqual([expect.objectContaining({ title: 'Landing page', repos: ['web'] })])
    expect(load['skill_gaps']).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'capability', capability: 'review' })]),
    )
    // T239: the Backend works in every repo, so `web` is covered and is no gap.
    expect(load['skill_gaps']).not.toContainEqual(expect.objectContaining({ kind: 'repo' }))
    expect(load['roles']).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Frontend' })]))
    expect(load['role_load']).toEqual(expect.arrayContaining([{ name: 'Backend', employees: 1, wip: 1 }]))
    expect(load['todo_by_repo']).toEqual([{ repo: 'web', count: 1 }])
    expect(load['blocked']).toBe(0)
    expect(load['review_wait']).toEqual({ average_minutes: null, tickets_measured: 0 })
    expect(load['headcount']).toEqual({ current: 2, max: null })
  })
})

describe('hire_request over MCP', () => {
  it('opens a gated approval thread and tells the hirer to wait', async () => {
    const { engine, pam, connectAs } = await setup()
    const employee = await connectAs(pam.id)

    const result = await employee.call('hire_request', { role: 'Frontend', reason: 'Two UI tickets unassigned' })

    const [approval] = engine.approvals.list()
    expect(approval).toMatchObject({ action: 'hire', requesterId: pam.id, status: 'pending' })
    expect(result.json()).toMatchObject({
      status: 'pending',
      approval_id: approval!.id,
      thread: { channel: '#general', message_id: approval!.messageId },
    })
    expect(result.json()['next']).toMatch(/wait/i)
  })

  it('proposes a model for the hire, and refuses an unknown one', async () => {
    const { engine, pam, connectAs } = await setup()
    const employee = await connectAs(pam.id)

    const asked = await employee.call('hire_request', { role: 'qa', reason: 'Bugs', model: 'sonnet-5-fast' })
    const refused = await employee.call('hire_request', { role: 'qa', reason: 'Bugs', model: 'gpt-9' })

    expect(asked.json()).toMatchObject({ status: 'pending' })
    expect(engine.hiring.requests()).toEqual([expect.objectContaining({ model: 'sonnet-5-fast' })])
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/unknown model.*opus-5-balanced/i) })
    engine.approvals.decide(asked.json()['approval_id'] as number, { approve: true })
    expect(engine.employees.list().at(-1)).toMatchObject({ title: 'QA', model: 'sonnet-5-fast' })
  })

  it('refuses an Employee without the hire capability', async () => {
    const { engine, ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const result = await employee.call('hire_request', { role: 'Frontend', reason: 'Help' })

    expect(result).toMatchObject({ isError: true, text: expect.stringMatching(/hire capability/i) })
    expect(engine.approvals.list()).toEqual([])
  })

  it('once approved, the new Employee is spawned and greets #general', async () => {
    const { engine, provider, pam, connectAs } = await setup()
    const employee = await connectAs(pam.id)
    const asked = await employee.call('hire_request', { role: 'qa', reason: 'Nobody reviews' })

    engine.approvals.decide(asked.json()['approval_id'] as number, { approve: true })

    const hired = engine.employees.list().at(-1)!
    expect(hired.title).toBe('QA')
    expect(provider.spawnOf(hired.id)).toBeDefined()
    expect(engine.chat().read({ channelId: 'general' }).at(-1)).toMatchObject({ authorId: hired.id })
  })

  it('under Autonomous, hires at once and says who', async () => {
    const { engine, pam, connectAs } = await setup()
    engine.approvals.setLevel('autonomous')
    const employee = await connectAs(pam.id)

    const result = await employee.call('hire_request', { role: 'qa', reason: 'Bugs', name: 'Quinn' })

    expect(result.json()).toMatchObject({ status: 'hired', employee: { name: 'Quinn', title: 'QA' } })
    expect(engine.employees.list().map((e) => e.name)).toContain('Quinn')
  })
})

describe('fire_request over MCP', () => {
  it('asks the boss to fire a colleague by name', async () => {
    const { engine, pam, connectAs } = await setup()
    const employee = await connectAs(pam.id)

    const result = await employee.call('fire_request', { employee: '@Ada', reason: 'The API is done' })

    expect(result.json()).toMatchObject({ status: 'pending' })
    expect(engine.approvals.list()).toEqual([
      expect.objectContaining({ action: 'fire', subject: expect.stringContaining('Ada') }),
    ])
  })

  it('reports an unknown colleague as a tool error', async () => {
    const { pam, connectAs } = await setup()
    const employee = await connectAs(pam.id)

    const result = await employee.call('fire_request', { employee: 'Zed', reason: 'x' })

    expect(result).toMatchObject({ isError: true, text: expect.stringMatching(/nobody is called zed/i) })
  })
})
