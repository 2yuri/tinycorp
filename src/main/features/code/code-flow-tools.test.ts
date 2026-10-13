import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
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
    git: fakeGit(),
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })

  async function connectAs(employeeId: string) {
    engine.sessions.start(employeeId)
    const { url, token } = provider.spawnOf(employeeId).mcp!
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
    cleanups.push(() => client.close())
    return async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { text: string }[]
      }
      const text = result.content.map((c) => c.text).join('')
      if (result.isError) throw new Error(text)
      // biome-ignore lint/suspicious/noExplicitAny: an MCP tool answers JSON with no static shape; the assertions below are the check
      return JSON.parse(text) as any
    }
  }
  return { engine, ada, web, connectAs }
}

describe('Code flow over MCP', () => {
  it('answers a claim with the ticket’s worktrees and where to work', async () => {
    const { engine, ada, web, connectAs } = await setup()
    const ticket = engine.board().createTicket({ title: 'Login page', column: 'todo', repos: [web.id] })
    const call = await connectAs(ada.id)

    const claimed = await call('ticket_claim', { ticket_id: ticket.id })

    const path = `${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`
    expect(claimed).toMatchObject({
      id: `AC-${ticket.id}`,
      number: ticket.id,
      column: 'doing',
      worktrees: [{ repo: 'web', path, branch: `ticket-ac-${ticket.id}-login-page` }],
      pull_requests: [],
    })
    expect(claimed.next).toContain(path)
  })

  it('lists a ticket’s PRs once they are open', async () => {
    const { engine, ada, web, connectAs } = await setup()
    engine.approvals.setLevel('autonomous')
    const ticket = engine.board().createTicket({ title: 'Login page', column: 'todo', repos: [web.id] })
    const call = await connectAs(ada.id)
    await call('ticket_claim', { ticket_id: ticket.id })

    await call('ticket_move', { ticket_id: ticket.id, column: 'review' })
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    const { tickets } = await call('board_list', { mine: true })
    expect(tickets[0].pull_requests).toEqual([{ repo: 'web', url: engine.code.of(ticket.id).pullRequests[0]!.url }])
  })
})
