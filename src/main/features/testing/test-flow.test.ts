import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import type { TestMode } from '../../../shared/testing'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const CRITERIA = ['Picker offers 7d, 30d, 90d and a custom range', 'The range lives in the URL']

/**
 * A Company with a planner, an assignee, a reviewer and a QA agent, two repos, and a ticket that
 * can be walked all the way to an approved review.
 */
function setup({ qa = true }: { qa?: boolean } = {}) {
  const provider = fakeProvider()
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const iris = qa ? engine.employees.create({ name: 'Iris', roleId: 'qa' }) : null
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  const board = () => engine.board()
  const ticketOf = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!
  const prs = () => engine.chat().read({ channelId: 'prs' })

  /** A ticket of Ada's in `repos`, planned with two acceptance criteria and waiting on its review. */
  async function reviewed(repos: string[] = [web.id]) {
    const ticket = board().createTicket({ title: 'Usage chart', assigneeId: ada.id, repos })
    const subject = { kind: 'ticket', id: ticket.id } as const
    engine.planning.as(nova.id).draft(subject, { goal: 'Usage over a range', acceptanceCriteria: CRITERIA })
    engine.planning.approve(engine.planning.of(subject)!.id)
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }

  /** The same ticket, with the review approved by the boss. */
  async function approved(repos?: string[]) {
    const ticket = await reviewed(repos)
    engine.reviews.approve(ticket.id)
    return ticket
  }

  function setMode(mode: TestMode) {
    engine.tests.setMode(mode)
  }

  return {
    engine,
    git,
    provider,
    nova,
    ada,
    rev,
    iris,
    web,
    api,
    board,
    ticketOf,
    prs,
    callerFor,
    reviewed,
    approved,
    setMode,
  }
}

describe('Entering Testing', () => {
  it('sends an approved review to Testing with the plan’s acceptance criteria as its script', async () => {
    const { engine, ticketOf, setMode, approved } = setup()
    setMode('you')

    const ticket = await approved()

    expect(ticketOf(ticket.id).column).toBe('testing')
    const run = engine.tests.of(ticket.id)!
    expect(run).toMatchObject({ attempt: 1, mode: 'you', state: 'you', agentId: null })
    expect(run.steps.map((step) => [step.criterion, step.title, step.result])).toEqual([
      [1, CRITERIA[0], 'pending'],
      [2, CRITERIA[1], 'pending'],
    ])
    // Nothing merged: the merge gate never came up.
    expect(engine.reviews.of(ticket.id)!.merge).toBeNull()
  })

  it('merges straight after review when nobody tests, which is what it always did', async () => {
    const { engine, git, ticketOf, setMode, approved } = setup()
    setMode('nobody')

    const ticket = await approved()

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(engine.tests.of(ticket.id)).toBeNull()
    expect(git.merges).toHaveLength(1)
  })

  it('takes the strictest mode of the ticket’s repos: one repo tested by the boss is enough', async () => {
    const { engine, web, api, setMode, approved } = setup()
    setMode('nobody')
    engine.tests.setRepo(web.id, { mode: 'you' })

    const ticket = await approved([web.id, api.id])

    expect(engine.tests.of(ticket.id)).toMatchObject({ mode: 'you', state: 'you' })
  })

  it('asks for both when one repo wants the agent and another wants the boss', async () => {
    const { engine, web, api, setMode, approved } = setup()
    setMode('nobody')
    engine.tests.setRepo(web.id, { mode: 'agent' })
    engine.tests.setRepo(api.id, { mode: 'you' })

    const ticket = await approved([web.id, api.id])

    expect(engine.tests.of(ticket.id)).toMatchObject({ mode: 'both', state: 'agent' })
  })

  it('wakes the QA agent once, with the script and how to run the app', async () => {
    const { engine, iris, web, setMode, approved } = setup()
    setMode('agent')
    engine.tests.setRepo(web.id, { runCommand: 'pnpm dev', port: 5173 })

    const ticket = await approved()

    expect(engine.tests.of(ticket.id)).toMatchObject({ mode: 'agent', state: 'agent', agentId: iris!.id })
    const woken = engine.inbox.list(iris!.id).filter((item) => item.kind === 'testing')
    expect(woken).toHaveLength(1)
    expect(woken[0]!.prompt).toContain('test_run_app')
    expect(woken[0]!.prompt).toContain('pnpm dev')
    expect(woken[0]!.prompt).toContain('port 5173')
    expect(woken[0]!.prompt).toContain(CRITERIA[0])
    expect(woken[0]!.prompt).toMatch(/running app, not by reading the code/i)
  })

  it('falls back to the boss, and says so, when the mode wants an agent and nobody holds test', async () => {
    const { engine, prs, setMode, approved } = setup({ qa: false })
    setMode('both')

    const ticket = await approved()

    expect(engine.tests.of(ticket.id)).toMatchObject({ mode: 'you', state: 'you', agentId: null })
    expect(
      prs()
        .map((m) => m.text)
        .join('\n'),
    ).toMatch(/nobody here holds the test capability/i)
  })

  it('files the boss’s turn as one message that names them, which is what the Inbox reads', async () => {
    const { engine, prs, setMode, approved } = setup()
    setMode('you')

    const ticket = await approved()

    const asked = prs().find((message) => message.mentions.includes(BOSS))!
    expect(asked).toMatchObject({ authorId: COMPANY_AUTHOR, testRunId: engine.tests.of(ticket.id)!.id })
    expect(asked.text).toContain('2 steps')
  })
})

describe('The merge waits for Testing', () => {
  it('refuses the merge while a step is still to test, whatever the autonomy level', async () => {
    const { engine, git, setMode, approved, ticketOf } = setup()
    engine.approvals.setLevel('autonomous')
    setMode('you')

    const ticket = await approved()

    expect(engine.tests.refusal(ticket.id)).toMatch(/waits for testing to pass/i)
    expect(git.merges).toHaveLength(0)
    expect(ticketOf(ticket.id).column).toBe('testing')
  })

  it('merges once the boss passes it, and stops asking anybody else', async () => {
    const { engine, git, ticketOf, setMode, approved } = setup()
    setMode('you')
    const ticket = await approved()
    const run = engine.tests.of(ticket.id)!
    for (const step of run.steps) engine.tests.setStep({ stepId: step.id, result: 'pass' })

    engine.tests.pass(ticket.id)

    expect(engine.tests.of(ticket.id)).toMatchObject({ state: 'passed' })
    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(git.merges).toHaveLength(1)
  })

  it('refuses to pass while a step failed or is untested', async () => {
    const { engine, setMode, approved } = setup()
    setMode('you')
    const ticket = await approved()
    const [first] = engine.tests.of(ticket.id)!.steps

    expect(() => engine.tests.pass(ticket.id)).toThrow(/2 still to test/i)
    engine.tests.setStep({ stepId: first!.id, result: 'fail', note: '90d shows 89 days' })
    expect(() => engine.tests.pass(ticket.id)).toThrow(/1 failed/i)
  })
})

describe('The QA agent’s pass', () => {
  /** A ticket in Testing with Iris on it, its app runnable. */
  async function testing(mode: TestMode = 'agent') {
    const s = setup()
    s.setMode(mode)
    s.engine.tests.setRepo(s.web.id, { runCommand: 'pnpm dev', port: 5173 })
    const ticket = await s.approved()
    return { ...s, ticket, iris: s.iris! }
  }

  it('raises the merge on its own in QA agent mode', async () => {
    const { engine, git, iris, ticket, ticketOf, callerFor } = await testing('agent')
    const tests = callerFor(iris.id).tests

    for (const step of tests.plan(ticket.id).steps) {
      tests.setStep({ stepId: step.id, result: 'pass', note: 'matches the invoice list' })
    }
    tests.submit({
      ticketId: ticket.id,
      verdict: 'pass',
      summary: 'All criteria pass in the running app.',
      checks: ['typecheck'],
    })

    expect(engine.tests.of(ticket.id)).toMatchObject({ state: 'passed', agentVerdict: 'pass', checks: ['typecheck'] })
    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(git.merges).toHaveLength(1)
  })

  it('hands the ticket to the boss in Both mode, and merges nothing until they confirm', async () => {
    const { engine, git, iris, ticket, prs, callerFor } = await testing('both')
    const tests = callerFor(iris.id).tests

    for (const step of tests.plan(ticket.id).steps) tests.setStep({ stepId: step.id, result: 'pass' })
    tests.submit({ ticketId: ticket.id, verdict: 'pass', summary: 'Four of four pass.' })

    expect(engine.tests.of(ticket.id)).toMatchObject({ state: 'you', agentVerdict: 'pass' })
    expect(git.merges).toHaveLength(0)
    const evidence = prs().find((message) => message.authorId === iris.id)!
    expect(evidence.testRunId).toBe(engine.tests.of(ticket.id)!.id)
    expect(prs().some((message) => message.mentions.includes(BOSS))).toBe(true)

    engine.tests.pass(ticket.id)
    await vi.waitFor(() => expect(git.merges).toHaveLength(1))
  })

  it('refuses a pass while a step is failed or untested', async () => {
    const { iris, ticket, callerFor } = await testing('agent')
    const tests = callerFor(iris.id).tests
    const [first, second] = tests.plan(ticket.id).steps

    expect(() => tests.submit({ ticketId: ticket.id, verdict: 'pass', summary: 'done' })).toThrow(/still to test/i)
    tests.setStep({ stepId: first!.id, result: 'pass' })
    tests.setStep({ stepId: second!.id, result: 'fail', note: 'the first bar is missing' })
    expect(() => tests.submit({ ticketId: ticket.id, verdict: 'pass', summary: 'done' })).toThrow(/not a pass/i)
  })

  it('lets it add the step the plan never wrote, credited to it', async () => {
    const { engine, iris, ticket, callerFor } = await testing('agent')

    callerFor(iris.id).tests.addStep({ ticketId: ticket.id, title: 'Empty states match the invoice list' })

    expect(engine.tests.of(ticket.id)!.steps.at(-1)).toMatchObject({
      title: 'Empty states match the invoice list',
      criterion: null,
      addedBy: iris.id,
    })
  })

  it('is nobody else’s to submit', async () => {
    const { ada, ticket, callerFor } = await testing('agent')

    expect(() => callerFor(ada.id).tests.plan(ticket.id)).toThrow(/is Iris’s, not yours/i)
  })
})

describe('A failed attempt', () => {
  it('opens the bug thread to the assignee, wakes them once and sends the ticket back to Doing', async () => {
    const { engine, ada, iris, ticketOf, prs, setMode, approved, callerFor } = setup()
    setMode('agent')
    const ticket = await approved()
    const tests = callerFor(iris!.id).tests
    const [first, second] = tests.plan(ticket.id).steps
    tests.setStep({ stepId: first!.id, result: 'fail', note: '90d shows 89 days' })
    tests.setStep({ stepId: second!.id, result: 'fail', note: 'the URL loses the range' })

    tests.submit({ ticketId: ticket.id, verdict: 'fail', summary: 'Criterion 1 fails on 90d.' })

    expect(engine.tests.of(ticket.id)).toMatchObject({ state: 'failed', agentVerdict: 'fail' })
    expect(ticketOf(ticket.id).column).toBe('doing')
    const bug = prs().find((message) => message.text.includes('failed testing'))!
    expect(prs().filter((message) => message.text.includes('failed testing'))).toHaveLength(1)
    expect(bug.mentions).toContain(ada.id)
    expect(bug.text).toContain('90d shows 89 days')
    expect(bug.testRunId).toBe(engine.tests.of(ticket.id)!.id)
    // Two failed steps, one attempt, one wake.
    const woken = engine.inbox.list(ada.id).filter((item) => item.kind === 'testing')
    expect(woken).toHaveLength(1)
    expect(woken[0]!.prompt).toContain('review_ready')
  })

  it('makes the boss’s bug report a step of its own when they marked nothing', async () => {
    const { engine, ticketOf, setMode, approved } = setup()
    setMode('you')
    const ticket = await approved()

    engine.tests.reportBug({ ticketId: ticket.id, note: 'The chart never loads' })

    const run = engine.tests.of(ticket.id)!
    expect(run.state).toBe('failed')
    expect(run.steps.at(-1)).toMatchObject({ title: 'The chart never loads', result: 'fail', testedBy: BOSS })
    expect(ticketOf(ticket.id).column).toBe('doing')
  })

  it('starts a second attempt when review approves again, keeping the first one to read', async () => {
    const { engine, ada, ticketOf, setMode, approved, callerFor } = setup()
    setMode('you')
    const ticket = await approved()
    engine.tests.reportBug({ ticketId: ticket.id, note: 'It does not load' })

    callerFor(ada.id).reviews.ready({ ticketId: ticket.id, summary: 'Fixed the range' })
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)!.status).toBe('pending'))
    engine.reviews.approve(ticket.id)

    expect(ticketOf(ticket.id).column).toBe('testing')
    expect(engine.tests.of(ticket.id)).toMatchObject({ attempt: 2, state: 'you' })
    // The first attempt is still there, with what failed on it.
    expect(engine.tests.of(ticket.id)!.steps.every((step) => step.result === 'pending')).toBe(true)
  })

  it('refuses a merge asked for while the ticket is back in Doing', async () => {
    const { engine, setMode, approved } = setup()
    setMode('you')
    const ticket = await approved()

    engine.tests.reportBug({ ticketId: ticket.id, note: 'It does not load' })

    expect(engine.tests.refusal(ticket.id)).toMatch(/failed testing/i)
  })
})
