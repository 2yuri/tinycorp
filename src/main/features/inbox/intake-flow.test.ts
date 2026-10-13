import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
})

const node = readyStack({ framework: 'Node' })

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
  provider.connect(engine.sessions.receiveHook)
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  engine.repos.add({ path: onDisk('/code/api'), stack: node })

  /** Starts the Employee's Session, lets it become idle, and connects to MCP as it. */
  async function startIdle(employeeId: string) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    vi.useRealTimers()
    const client = new Client({ name: 'employee', version: '0.0.0' })
    await client.connect(mcpTransport(session.mcp!.url, { authorization: `Bearer ${session.mcp!.token}` }))
    cleanups.push(() => client.close())
    async function call(name: string, args: Record<string, unknown>) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean
        content: { text: string }[]
      }
      const text = result.content.map((c) => c.text).join('')
      if (result.isError) throw new Error(text)
      // biome-ignore lint/suspicious/noExplicitAny: an MCP tool answers JSON with no static shape; the assertions below are the check
      return JSON.parse(text) as any
    }
    /** Accepts the pushed prompt and finishes the turn, as a real CLI would. */
    function finishTurn() {
      session.hook('UserPromptSubmit')
      session.hook('Stop')
    }
    return { session, call, finishTurn }
  }

  const post = (channelId: string, text: string) => engine.chat().post({ authorId: BOSS, channelId, text })
  return { engine, startIdle, post }
}

describe('Intake through capabilities, as Employees see it', () => {
  it('turns a boss goal into a target, an epic and tickets, and wakes the engineer given one', async () => {
    const { engine, startIdle, post } = await setup()
    const pam = engine.employees.create({ name: 'Pam', roleId: 'pm' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const intake = await startIdle(pam.id)
    const engineer = await startIdle(ada.id)

    post('tech', 'magic-link login in the api, by Friday')

    expect(intake.session.pushed).toEqual([expect.stringContaining('"magic-link login in the api, by Friday"')])
    expect(intake.session.pushed[0]).toContain('target_create')
    expect(engineer.session.pushed).toEqual([])
    intake.finishTurn()

    const target = await intake.call('target_create', { title: 'Magic-link login' })
    const epic = await intake.call('epic_create', { title: 'Login', target_id: target.id })
    const ticket = await intake.call('ticket_create', {
      title: 'Send the magic link',
      epic_id: epic.id,
      assignee: 'Ada',
      repos: ['api'],
    })

    expect(engine.board().snapshot()).toMatchObject({
      targets: [{ id: target.id, title: 'Magic-link login' }],
      epics: [{ id: epic.id, targetId: target.id }],
      tickets: [{ id: ticket.number, epicId: epic.id, assigneeId: ada.id, column: 'planning' }],
    })
    expect(engineer.session.pushed).toEqual([expect.stringContaining(`${ticket.id as string}`)])
    expect(engineer.session.pushed[0]).toContain('ticket_claim')

    engineer.finishTurn()
    // T171: it is in Planning, so the engineer cannot claim it until Pam's plan is approved.
    await expect(engineer.call('ticket_claim', { ticket_id: ticket.id })).rejects.toThrow(/not Ready/i)
    await intake.call('plan_draft', {
      ticket_id: ticket.id,
      goal: 'One click to sign in',
      approach: 'Send a signed link that logs the visitor in.',
    })
    engine.planning.approve(engine.planning.of({ kind: 'ticket', id: ticket.number as number })!.id)
    await engineer.call('ticket_claim', { ticket_id: ticket.id })

    expect(engine.board().snapshot().tickets).toMatchObject([{ id: ticket.number, column: 'doing' }])
  })

  it('wakes the intake holder the boss DMs, with how to structure the goal', async () => {
    const { engine, startIdle, post } = await setup()
    const otto = engine.employees.create({ name: 'Otto', roleId: 'po' })
    engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const intake = await startIdle(otto.id)

    post(dmChannelId(BOSS, otto.id), 'dark mode')

    expect(intake.session.pushed).toEqual([expect.stringContaining('epic_create')])
  })

  it('lets the only Employee of a Company take intake and the work', async () => {
    const { engine, startIdle, post } = await setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const solo = await startIdle(ada.id)

    post('tech', 'rate-limit the api')

    expect(solo.session.pushed).toEqual([expect.stringContaining('ticket_create')])
    solo.finishTurn()
    const target = await solo.call('target_create', { title: 'Rate limiting' })
    const epic = await solo.call('epic_create', { title: 'Rate limits', target_id: target.id })
    // Straight to Ready: what planning does to a new ticket has its own tests (`planning.test.ts`).
    const ticket = await solo.call('ticket_create', {
      title: 'Token bucket',
      epic_id: epic.id,
      assignee: 'Ada',
      column: 'todo',
    })
    solo.finishTurn()
    await solo.call('ticket_claim', { ticket_id: ticket.id })

    expect(engine.board().snapshot().tickets).toMatchObject([
      { title: 'Token bucket', epicId: epic.id, assigneeId: ada.id, column: 'doing' },
    ])
  })
})
