import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
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
    mcpUrl: (companyId) => server!.urlFor(companyId),
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

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
        return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
      },
    }
  }
  return { engine, ada, connectAs }
}

describe('approval_request over MCP', () => {
  it('is listed with the gated actions it accepts', async () => {
    const { ada, connectAs } = await setup()
    const { client } = await connectAs(ada.id)

    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'approval_request')

    expect(tool).toBeDefined()
    expect(JSON.stringify(tool!.inputSchema)).toContain('merge')
  })

  it('under Supervised, asking to start work creates an Approval and tells the Employee to wait', async () => {
    const { engine, ada, connectAs } = await setup()
    engine.approvals.setLevel('supervised')
    const employee = await connectAs(ada.id)

    const result = await employee.call('approval_request', {
      action: 'start',
      subject: '#12 Login page',
      reason: 'Top of Todo',
    })

    const [approval] = engine.approvals.list()
    expect(approval).toMatchObject({
      requesterId: ada.id,
      action: 'start',
      subject: '#12 Login page',
      reason: 'Top of Todo',
      status: 'pending',
    })
    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({
      status: 'pending',
      approval_id: approval!.id,
      level: 'supervised',
      thread: { channel: '#general', message_id: approval!.messageId },
    })
    expect(result.json()['next']).toMatch(/wait/i)
    expect(result.json()['next']).toMatch(/inbox/i)
    expect(engine.chat().read({ channelId: 'general' })).toEqual([
      expect.objectContaining({ id: approval!.messageId, authorId: ada.id, mentions: [BOSS] }),
    ])
  })

  it('under Managed, starting work needs no approval', async () => {
    const { engine, ada, connectAs } = await setup()
    const employee = await connectAs(ada.id)

    const result = await employee.call('approval_request', { action: 'start', subject: '#12 Login page' })

    expect(result.json()).toMatchObject({ status: 'not_needed', level: 'managed' })
    expect(result.json()['next']).toMatch(/go ahead/i)
    expect(engine.approvals.list()).toEqual([])
  })

  it('passes CI and limit facts to the gate', async () => {
    const { engine, ada, connectAs } = await setup()
    engine.approvals.setLevel('autonomous')
    const employee = await connectAs(ada.id)

    const login = engine.board().createTicket({ title: 'Login page' })
    const signup = engine.board().createTicket({ title: 'Signup' })
    const green = await employee.call('approval_request', { action: 'merge', ticket: login.id })
    const red = await employee.call('approval_request', { action: 'merge', ticket: signup.id, ci_red: true })

    expect(green.json()).toMatchObject({ status: 'not_needed' })
    expect(red.json()).toMatchObject({ status: 'pending' })
    expect(engine.approvals.list()).toEqual([expect.objectContaining({ ticketId: signup.id })])
  })

  it('delivers the boss’s rejection and reason to the requester’s inbox', async () => {
    const { engine, ada, connectAs } = await setup()
    engine.approvals.setLevel('supervised')
    const employee = await connectAs(ada.id)
    const asked = await employee.call('approval_request', { action: 'start', subject: '#12 Login page' })

    engine.approvals.decide(asked.json()['approval_id'] as number, { approve: false, reason: 'Do #9 first' })

    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ kind: 'approval', prompt: expect.stringContaining('Do #9 first') }),
    ])
  })

  it('reports bad requests as tool errors', async () => {
    const { engine, ada, connectAs } = await setup()
    engine.approvals.setLevel('supervised')
    const employee = await connectAs(ada.id)

    const blank = await employee.call('approval_request', { action: 'start', subject: '  ' })
    const unknown = await employee.call('approval_request', { action: 'deploy', subject: 'prod' })

    expect(blank).toMatchObject({ isError: true, text: expect.stringMatching(/subject/i) })
    expect(unknown.isError).toBe(true)
    expect(engine.approvals.list()).toEqual([])
  })
})
