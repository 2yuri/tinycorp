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
  const git = fakeGit()
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
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
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

  async function inReview() {
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }
  return { engine, git, ada, rev, connectAs, inReview }
}

describe('review_submit over MCP', () => {
  it('requests changes as the reviewer, sending the ticket back to its assignee', async () => {
    const { engine, ada, rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const call = await connectAs(rev.id)

    const answer = await call('review_submit', {
      ticket_id: ticket.id,
      verdict: 'request_changes',
      comments: 'Validate the email.',
    })

    expect(answer).toMatchObject({ ticket: `AC-${ticket.id}`, status: 'changes_requested', next: expect.any(String) })
    expect(engine.board().snapshot().tickets[0]!.column).toBe('doing')
    expect(engine.inbox.list(ada.id).at(-1)!.prompt).toContain('Validate the email.')
  })

  it('approves as the reviewer and says the merge waits for the boss', async () => {
    const { engine, rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const call = await connectAs(rev.id)

    const answer = await call('review_submit', { ticket_id: ticket.id, verdict: 'approve' })

    expect(answer).toMatchObject({ ticket: `AC-${ticket.id}`, status: 'approved' })
    expect(answer.next).toMatch(/boss/)
    await vi.waitFor(() =>
      expect(engine.approvals.list({ status: 'pending' })).toEqual([expect.objectContaining({ action: 'merge' })]),
    )
  })

  it('refuses a verdict from someone who is not the reviewer', async () => {
    const { ada, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const call = await connectAs(ada.id)

    await expect(call('review_submit', { ticket_id: ticket.id, verdict: 'approve' })).rejects.toThrow(/Rev/)
  })

  it('shows a ticket’s review in board_list', async () => {
    const { rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const call = await connectAs(rev.id)

    const { tickets } = await call('board_list', { column: 'review' })

    expect(tickets.find((t: { number: number }) => t.number === ticket.id).review).toEqual({
      reviewer: 'Rev',
      status: 'pending',
      round: '1 of 3',
      comments: '',
      merge: null,
    })
  })
})

describe('The review conversation over MCP', () => {
  it('opens a thread, answers it, and sends the whole round to the PR at once', async () => {
    const { engine, git, ada, rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const reviewer = await connectAs(rev.id)
    const assignee = await connectAs(ada.id)

    const opened = await reviewer('review_comment', {
      ticket_id: ticket.id,
      file: 'src/format/currency.ts',
      line: 20,
      body: 'Intl throws on an unknown locale.',
    })
    expect(opened).toMatchObject({ where: 'src/format/currency.ts:20', state: 'open', round: 1 })
    expect(git.reviews).toEqual([])

    await reviewer('review_submit', { ticket_id: ticket.id, verdict: 'changes', summary: 'One thing below.' })

    await vi.waitFor(() => expect(git.reviews).toHaveLength(1))
    expect(git.reviews[0]!.threads).toEqual([
      { path: 'src/format/currency.ts', line: 20, body: 'Intl throws on an unknown locale.' },
    ])

    const replied = await assignee('review_reply', {
      thread: opened.thread,
      body: 'It is rejected at the boundary already.',
      commit: '3f2a1c9',
    })
    expect(replied).toMatchObject({ commit: '3f2a1c9', open: 1 })
    expect(replied.messages.at(-1)).toEqual({ from: 'Ada', said: 'It is rejected at the boundary already.' })

    const ready = await assignee('review_ready', { ticket_id: ticket.id, summary: 'Pushed 2 commits.' })
    expect(ready).toMatchObject({ ticket: `AC-${ticket.id}`, round: '2 of 3', reviewer: 'Rev' })
    expect(engine.inbox.list(rev.id).at(-1)!.prompt).toContain('Pushed 2 commits.')
  })

  it('will not let a reviewer answer as the assignee, or an assignee review', async () => {
    const { ada, rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const reviewer = await connectAs(rev.id)
    const assignee = await connectAs(ada.id)
    const opened = await reviewer('review_comment', { ticket_id: ticket.id, file: 'a.ts', line: 3, body: 'Name it.' })

    await expect(reviewer('review_reply', { thread: opened.thread, body: 'Done.' })).rejects.toThrow(
      /You are the reviewer/,
    )
    await expect(
      assignee('review_comment', { ticket_id: ticket.id, file: 'a.ts', line: 3, body: 'Looks fine.' }),
    ).rejects.toThrow(/is Rev’s, not yours/)
    await expect(assignee('review_resolve', { thread: opened.thread })).rejects.toThrow(/is Rev’s, not yours/)
  })

  it('refuses an approval while a blocking thread is open, and takes one once it is a note', async () => {
    const { rev, connectAs, inReview } = await setup()
    const ticket = await inReview()
    const reviewer = await connectAs(rev.id)
    const opened = await reviewer('review_comment', { ticket_id: ticket.id, file: 'a.ts', line: 3, body: 'No test.' })

    await expect(reviewer('review_submit', { ticket_id: ticket.id, verdict: 'approve' })).rejects.toThrow(
      /still open on AC-1/,
    )

    const noted = await reviewer('review_resolve', { thread: opened.thread, note: true })
    expect(noted).toMatchObject({ state: 'non_blocking' })
    expect(await reviewer('review_submit', { ticket_id: ticket.id, verdict: 'approve' })).toMatchObject({
      status: 'approved',
    })
  })

  it('tells the reviewer the argument is the boss’s once the round limit is reached', async () => {
    const { engine, rev, connectAs, inReview } = await setup()
    engine.reviews.setRoundLimit(1)
    const ticket = await inReview()
    const reviewer = await connectAs(rev.id)

    const answer = await reviewer('review_submit', {
      ticket_id: ticket.id,
      verdict: 'changes',
      summary: 'Still wrong.',
    })

    expect(answer).toMatchObject({ status: 'changes_requested', round: '1 of 1' })
    expect(answer.next).toMatch(/boss’s call/)
    expect(engine.board().snapshot().tickets[0]!.column).toBe('review')
  })
})
