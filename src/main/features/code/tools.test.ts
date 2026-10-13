import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { NOT_AN_APPROVAL } from './merge-gate'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup({ rung }: { rung?: 'local' | 'pr' | 'merge' } = {}) {
  let server: CompanyMcpServer | undefined
  const provider = fakeProvider()
  const git = fakeGit()
  git.withoutRemote(onDisk('/code/notes'))
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const notes = engine.repos.add({
    path: onDisk('/code/notes'),
    name: 'notes',
    stack: readyStack(),
    ...(rung && { rung }),
  })
  const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [notes.id] })
  engine.board().moveTicket(ticket.id, 'doing')
  engine.board().moveTicket(ticket.id, 'review')

  engine.sessions.start(ada.id)
  const { url, token } = provider.spawnOf(ada.id).mcp!
  const client = new Client({ name: 'employee', version: '0.0.0' })
  await client.connect(mcpTransport(url, { authorization: `Bearer ${token}` }))
  cleanups.push(() => client.close())
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] }
  const column = () =>
    engine
      .board()
      .snapshot()
      .tickets.find((t) => t.id === ticket.id)?.column
  return { engine, git, ticket, call, column }
}

describe('ticket_merge over MCP', () => {
  it('refuses without an approved merge approval, saying a chat message is not one', async () => {
    const { git, ticket, call, column } = await setup()

    const result = await call('ticket_merge', { ticket_id: ticket.id })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe(
      `Merging AC-${ticket.id} needs an approved merge approval, and there is none. ${NOT_AN_APPROVAL}`,
    )
    expect(git.localMerges).toEqual([])
    expect(column()).toBe('review')
  })

  it('refuses to move a ticket with a branch to done', async () => {
    const { ticket, call, column } = await setup()

    const result = await call('ticket_move', { ticket_id: ticket.id, column: 'done' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/the app moves it to Done when it merges/)
    expect(column()).toBe('review')
  })

  it('refuses in a PR only repo, naming the repo and the rung, whatever the approvals say', async () => {
    const { engine, git, ticket, call, column } = await setup({ rung: 'pr' })
    engine.approvals.setLevel('autonomous')

    const result = await call('ticket_merge', { ticket_id: ticket.id })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe(
      'notes is PR only. TinyCorp opens the PR and never merges it; the PR stays open for someone with the ' +
        'rights to merge it.',
    )
    expect(git.localMerges).toEqual([])
    expect(column()).toBe('review')
  })

  it('refuses in a local only repo, and asking for the approval is refused too', async () => {
    const { engine, git, ticket, call } = await setup({ rung: 'local' })

    const merge = await call('ticket_merge', { ticket_id: ticket.id })
    const ask = await call('approval_request', { action: 'merge', ticket: ticket.id, reason: 'Ready.' })

    expect(merge.isError).toBe(true)
    expect(merge.content[0]!.text).toContain('notes is local only.')
    expect(ask.isError).toBe(true)
    expect(ask.content[0]!.text).toContain('notes is local only.')
    expect(engine.approvals.list()).toEqual([])
    expect(git.localMerges).toEqual([])
  })

  it('merges once the merge approval asked with approval_request is approved', async () => {
    const { engine, git, ticket, call, column } = await setup()
    await call('approval_request', { action: 'merge', ticket: ticket.id, reason: 'Ready.' })
    const [approval] = engine.approvals.list({ status: 'pending' })
    engine.approvals.decide(approval!.id, { approve: true })
    await vi.waitFor(() => expect(column()).toBe('done'))

    expect(git.localMerges).toHaveLength(1)
    const again = await call('ticket_merge', { ticket_id: ticket.id })
    expect(again.content[0]!.text).toBe(`AC-${ticket.id} is not in review: move it to review first`)
  })
})
