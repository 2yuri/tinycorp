import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { type CompanyMcpServer, startCompanyMcpServer } from '../../core/engine/company-mcp-server'
import { inMemoryDatabases, inMemoryRecents, mcpTransport, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import type { SpawnRun } from './app-runs'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const CRITERIA = ['Picker offers 7d, 30d, 90d and a custom range', 'The range lives in the URL']

/** A Company whose QA agent tests every ticket, with a web app it can run. */
async function setup() {
  let server: CompanyMcpServer | undefined
  const started: { command: string; killed: boolean }[] = []
  const spawnRun: SpawnRun = ({ command }) => {
    const entry = { command, killed: false }
    started.push(entry)
    return {
      onOutput: () => {},
      onExit: () => {},
      kill: () => {
        entry.killed = true
      },
    }
  }
  const provider = fakeProvider()
  const git = fakeGit()
  const engine: CompanyEngine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    spawnRun,
    mcpUrl: (companyId) => server!.urlFor(companyId),
    log: () => {},
  })
  cleanups.push(() => engine.close())
  server = await startCompanyMcpServer(engine)
  cleanups.push(() => server!.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const iris = engine.employees.create({ name: 'Iris', roleId: 'qa' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  engine.tests.setMode('agent')
  engine.tests.setRepo(web.id, { runCommand: 'pnpm dev', port: 5173 })

  async function connectAs(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
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
      return JSON.parse(text) as Record<string, any>
    }
  }

  /** A ticket of Ada's, planned, reviewed, approved, and now Iris's to test. */
  async function inTesting() {
    const ticket = engine.board().createTicket({ title: 'Usage chart', assigneeId: ada.id, repos: [web.id] })
    const subject = { kind: 'ticket', id: ticket.id } as const
    engine.planning.as(nova.id).draft(subject, { goal: 'Usage over a range', acceptanceCriteria: CRITERIA })
    engine.planning.approve(engine.planning.of(subject)!.id)
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    engine.reviews.approve(ticket.id)
    return ticket
  }

  return { engine, git, started, ada, iris, rev, web, connectAs, inTesting }
}

describe('The QA agent’s tools over MCP', () => {
  it('reads the script, adds a step, and says what is left to test', async () => {
    const { iris, connectAs, inTesting } = await setup()
    const ticket = await inTesting()
    const call = await connectAs(iris.id)

    const script = await call('test_plan', { ticket_id: ticket.id })

    expect(script).toMatchObject({ ticket: `AC-${ticket.id}`, attempt: 1, who_tests: 'agent', to_test: 2 })
    const steps = script['steps'] as { number: number; what: number; criterion: number }[]
    expect(steps.map((step) => [step.number, step.what, step.criterion])).toEqual([
      [1, CRITERIA[0], 1],
      [2, CRITERIA[1], 2],
    ])

    const grown = await call('test_plan', { ticket_id: ticket.id, add: 'Empty states match the invoice list' })

    expect(grown['steps'].at(-1)).toMatchObject({
      what: 'Empty states match the invoice list',
      criterion: null,
      added_by: 'Iris',
    })
  })

  it('starts and stops the ticket’s app, and nothing else starts it', async () => {
    const { started, iris, connectAs, inTesting } = await setup()
    const ticket = await inTesting()
    const call = await connectAs(iris.id)
    expect(started).toEqual([])

    const app = await call('test_run_app', { ticket_id: ticket.id, action: 'start' })

    expect(app).toMatchObject({ repo: 'web', command: 'pnpm dev', state: 'running', url: 'http://localhost:5173' })
    expect(started).toEqual([{ command: 'pnpm dev', killed: false }])

    expect(await call('test_run_app', { ticket_id: ticket.id, action: 'stop' })).toMatchObject({ state: 'exited' })
    expect(started[0]!.killed).toBe(true)
  })

  it('records a step and ends with a pass that raises the merge', async () => {
    const { engine, git, iris, connectAs, inTesting } = await setup()
    const ticket = await inTesting()
    const call = await connectAs(iris.id)
    const script = await call('test_plan', { ticket_id: ticket.id })

    for (const step of script['steps']) {
      await call('test_step', { step: step.step, result: 'pass', note: 'matches the invoice list' })
    }
    const done = await call('test_submit', {
      ticket_id: ticket.id,
      verdict: 'pass',
      summary: 'All four criteria pass in the running app.',
      checks: ['typecheck', 'test · 142'],
    })

    expect(done).toMatchObject({ passed: 2, failed: 0, to_test: 0, next: expect.stringMatching(/merge goes ahead/) })
    expect(engine.tests.of(ticket.id)).toMatchObject({ state: 'passed', checks: ['typecheck', 'test · 142'] })
    await vi.waitFor(() => expect(git.merges).toHaveLength(1))
  })

  it('sends a fail back to the assignee with the note, and stops the app it was running', async () => {
    const { engine, started, ada, iris, connectAs, inTesting } = await setup()
    const ticket = await inTesting()
    const call = await connectAs(iris.id)
    await call('test_run_app', { ticket_id: ticket.id, action: 'start' })
    const script = await call('test_plan', { ticket_id: ticket.id })

    await call('test_step', { step: script['steps'][0]!.step, result: 'pass' })
    await call('test_step', { step: script['steps'][1]!.step, result: 'fail', note: '90d shows 89 days' })
    const done = await call('test_submit', {
      ticket_id: ticket.id,
      verdict: 'fail',
      summary: 'Criterion 2 fails on 90d.',
    })

    expect(done['next']).toMatch(/assignee has it back/i)
    expect(engine.board().snapshot().tickets[0]!.column).toBe('doing')
    const woken = engine.inbox.list(ada.id).filter((item) => item.kind === 'testing')
    expect(woken).toHaveLength(1)
    expect(woken[0]!.prompt).toContain('90d shows 89 days')
    expect(started[0]!.killed).toBe(true)
  })

  it('refuses a pass while a step is untested, and refuses the ticket to anybody else', async () => {
    const { ada, iris, connectAs, inTesting } = await setup()
    const ticket = await inTesting()
    const iriscall = await connectAs(iris.id)
    const adacall = await connectAs(ada.id)

    await expect(
      iriscall('test_submit', { ticket_id: ticket.id, verdict: 'pass', summary: 'looks fine' }),
    ).rejects.toThrow(/still to test/i)
    await expect(adacall('test_plan', { ticket_id: ticket.id })).rejects.toThrow(/Iris/)
  })
})
