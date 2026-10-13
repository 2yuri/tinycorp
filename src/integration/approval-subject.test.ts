import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../main/core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../main/core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../main/core/testing'
import { fakeGit } from '../main/platform/testing'
import { fakeProvider } from '../main/providers/testing'
import { type ChatData, cardOf } from '../renderer/src/chat/chat-view'
import { APPROVAL_SUBJECT_RULE } from '../shared/approvals/approval-subject'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Ada, over MCP, with a ticket in Review whose PRs are open in web and api. */
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
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
  const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })
  engine.board().moveTicket(ticket.id, 'doing')
  engine.board().moveTicket(ticket.id, 'review')
  await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
  engine.approvals.setLevel('supervised')

  engine.sessions.start(ada.id)
  const { url, token } = provider.spawnOf(ada.id).mcp!
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
  cleanups.push(() => client.close())
  async function call(args: Record<string, unknown>) {
    const result = (await client.callTool({ name: 'approval_request', arguments: args })) as {
      isError?: boolean
      content: { text: string }[]
    }
    const text = result.content.map((c) => c.text).join('')
    return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, unknown> }
  }

  /** What the chat view is given, read from the engine. */
  function chatData(): ChatData {
    return {
      employees: engine.employees.list(),
      companyKey: engine.currentCompany()?.key ?? '',
      board: engine.board().snapshot(),
      code: engine.code.list(),
      repos: engine.repos.list(),
      approvals: new Map(engine.approvals.list().map((a) => [a.messageId, a])),
      reviews: engine.reviews.list(),
    }
  }
  const pr = (repoId: string) => engine.code.of(ticket.id).pullRequests.find((p) => p.repoId === repoId)!
  return { engine, client, call, chatData, ticket, web, api, pr }
}

describe('approval_request names what it is about', () => {
  it('describes one subject rule for merges', async () => {
    const { client } = await setup()
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'approval_request')!

    expect(tool.description).toContain(APPROVAL_SUBJECT_RULE)
    expect(tool.description).not.toMatch(/PR 7 on api/)
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toEqual(
      expect.arrayContaining(['ticket', 'pr', 'subject']),
    )
  })

  it('an agent-requested merge of a PR gets the ticket’s subject, and its PR card in chat', async () => {
    const { engine, call, chatData, ticket, api, pr } = await setup()

    const result = await call({ action: 'merge', pr: { repo: 'api', number: pr(api.id).number }, reason: 'Green' })

    expect(result.json()).toMatchObject({ status: 'pending', subject: `AC-${ticket.id} Login page` })
    const [approval] = engine.approvals.list()
    expect(approval).toMatchObject({
      action: 'merge',
      subject: `AC-${ticket.id} Login page`,
      ticketId: ticket.id,
      pullRequest: { repoId: api.id, number: pr(api.id).number },
    })
    const root = engine
      .chat()
      .read({ channelId: 'general' })
      .find((m) => m.id === approval!.messageId)!
    expect(cardOf(root, chatData())).toEqual({
      kind: 'pr',
      waiting: true,
      ticketId: ticket.id,
      pullRequests: [{ repo: 'api', number: pr(api.id).number, url: pr(api.id).url, title: 'Login page' }],
      reviewer: 'Waiting for you',
      replies: 0,
      handoff: 'agents',
      round: expect.any(String),
    })
  })

  it('an agent-requested merge of a ticket shows all of its PRs', async () => {
    const { engine, call, chatData, ticket } = await setup()

    await call({ action: 'merge', ticket: ticket.id })

    const [approval] = engine.approvals.list()
    const root = engine
      .chat()
      .read({ channelId: 'general' })
      .find((m) => m.id === approval!.messageId)!
    expect(cardOf(root, chatData())).toMatchObject({
      kind: 'pr',
      pullRequests: [{ repo: 'web' }, { repo: 'api' }],
    })
  })

  it('reports a merge that names no ticket, an unknown repo or a PR that does not exist as tool errors', async () => {
    const { engine, call } = await setup()

    expect(await call({ action: 'merge', subject: 'PR 7 on api' })).toMatchObject({
      isError: true,
      text: expect.stringMatching(/needs the ticket/i),
    })
    expect(await call({ action: 'merge', pr: { repo: 'mobile', number: 1 } })).toMatchObject({
      isError: true,
      text: expect.stringMatching(/no repo named "mobile"/i),
    })
    expect(await call({ action: 'merge', pr: { repo: 'api', number: 999 } })).toMatchObject({ isError: true })
    expect(engine.approvals.list()).toEqual([])
  })
})
