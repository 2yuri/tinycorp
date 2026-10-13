import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

/**
 * The review conversation (T170): rounds, threads, the round limit, when the boss is asked, and
 * what each round wakes.
 *
 * Everything here goes through the engine the way the app does — a reviewer who holds `review`, an
 * assignee who holds the ticket, and a fake git so nothing touches a forge.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

function setup() {
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
  const acme = engine.createCompany({ folder: '/work/acme', name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const web = engine.repos.add({ path: '/code/web', name: 'web', stack: node })

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  async function inReview() {
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }

  /** One round of changes requested with a thread on a line, answered by the assignee. */
  async function round(ticketId: number, body = 'Wrap this in a try/catch.') {
    const reviewer = callerFor(rev.id).reviews
    const thread = reviewer.openThread({ ticketId, path: 'src/format/currency.ts', line: 20, body })
    reviewer.submit({ ticketId, verdict: 'request_changes', comments: 'One thing below.' })
    return thread
  }

  return { engine, git, ada, rev, web, callerFor, inReview, round }
}

describe('Threads of a review round', () => {
  it('belong to the round they were opened in, and carry every message in order', async () => {
    const { engine, ada, rev, web, callerFor, inReview } = setup()
    const ticket = await inReview()

    const opened = callerFor(rev.id).reviews.openThread({
      ticketId: ticket.id,
      path: 'src/format/currency.ts',
      line: 20,
      body: 'Intl throws on an unknown locale.',
    })
    callerFor(ada.id).reviews.replyInThread({
      threadId: opened.id,
      body: 'A try/catch would hide a bad locale.',
      commit: '3f2a1c9',
    })

    const [thread] = engine.reviews.threads(ticket.id)
    expect(thread).toMatchObject({
      ticketId: ticket.id,
      round: 1,
      repoId: web.id,
      path: 'src/format/currency.ts',
      line: 20,
      state: 'open',
      commit: '3f2a1c9',
    })
    expect(thread!.messages.map((m) => [m.authorId, m.body, m.round])).toEqual([
      [rev.id, 'Intl throws on an unknown locale.', 1],
      [ada.id, 'A try/catch would hide a bad locale.', 1],
    ])
  })

  it('go on the PR as one review when the round closes, not a comment at a time', async () => {
    const { engine, git, rev, callerFor, inReview } = setup()
    const ticket = await inReview()
    const [pr] = engine.code.of(ticket.id).pullRequests
    const reviewer = callerFor(rev.id).reviews

    reviewer.openThread({ ticketId: ticket.id, path: 'a.ts', line: 3, body: 'Name it.' })
    reviewer.openThread({ ticketId: ticket.id, path: 'b.ts', line: 9, body: 'Drop this.' })
    expect(git.reviews).toEqual([])

    reviewer.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: 'Two things.' })

    await vi.waitFor(() => expect(git.reviews).toHaveLength(1))
    expect(git.reviews[0]).toMatchObject({
      repoPath: onDisk('/code/web'),
      url: pr!.url,
      verdict: 'changes',
      threads: [
        { path: 'a.ts', line: 3, body: 'Name it.' },
        { path: 'b.ts', line: 9, body: 'Drop this.' },
      ],
    })
    // And each thread remembers where the forge put it, so a reply can land in the same place.
    await vi.waitFor(() => expect(engine.reviews.threads(ticket.id).every((t) => t.url !== null)).toBe(true))
  })

  it('mirror a reply and a resolution to the forge once the thread is on it', async () => {
    const { engine, git, ada, rev, callerFor, inReview, round } = setup()
    const ticket = await inReview()
    const thread = await round(ticket.id)
    await vi.waitFor(() => expect(engine.reviews.threads(ticket.id)[0]!.url).not.toBeNull())

    callerFor(ada.id).reviews.replyInThread({ threadId: thread.id, body: 'Fixed in 3f2a1c9.' })
    callerFor(ada.id).reviews.ready({ ticketId: ticket.id })
    callerFor(rev.id).reviews.setThreadState(thread.id, 'resolved')

    await vi.waitFor(() => expect(git.threadReplies).toHaveLength(1))
    expect(git.threadReplies[0]).toMatchObject({ body: 'Fixed in 3f2a1c9.' })
    await vi.waitFor(() => expect(git.resolvedThreads).toHaveLength(1))
    expect(engine.reviews.threads(ticket.id)[0]).toMatchObject({ state: 'resolved', resolvedBy: rev.id })
  })

  it('stay in the app, and say so, where the repo’s forge cannot hold them', async () => {
    const { engine, git, rev, callerFor, inReview } = setup()
    git.withoutReviews(onDisk('/code/web'))
    const ticket = await inReview()

    callerFor(rev.id).reviews.openThread({ ticketId: ticket.id, path: 'a.ts', line: 3, body: 'Name it.' })
    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: 'One thing.' })

    expect(engine.reviews.threadsOnForge(ticket.id)).toBe(false)
    expect(engine.reviews.threads(ticket.id)[0]).toMatchObject({ url: null })
    // The verdict still reaches the PR the only way this repo can take it.
    await vi.waitFor(() => expect(git.comments).toHaveLength(1))
    expect(git.reviews).toEqual([])
  })
})

describe('Approving a round', () => {
  it('is refused while a blocking thread is open, and allowed with a note', async () => {
    const { engine, rev, callerFor, inReview } = setup()
    const ticket = await inReview()
    const reviewer = callerFor(rev.id).reviews
    const thread = reviewer.openThread({ ticketId: ticket.id, path: 'a.ts', line: 3, body: 'No test for this.' })

    expect(() => reviewer.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'Ship it.' })).toThrow(
      /still open on AC-1.*a\.ts:3/,
    )

    reviewer.setThreadState(thread.id, 'non_blocking')
    const review = reviewer.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'Ship it.' })

    expect(review).toMatchObject({ status: 'approved', handoff: 'ready' })
    expect(engine.reviews.threads(ticket.id)[0]).toMatchObject({ state: 'non_blocking' })
  })

  it('raises the merge gate only then, and never while the agents are still talking', async () => {
    const { engine, ada, rev, callerFor, inReview, round } = setup()
    const ticket = await inReview()
    const thread = await round(ticket.id)

    expect(engine.approvals.list()).toEqual([])
    expect(engine.reviews.of(ticket.id)).toMatchObject({ handoff: 'agents', merge: null })

    callerFor(ada.id).reviews.replyInThread({ threadId: thread.id, body: 'Fixed.', commit: '3f2a1c9' })
    callerFor(ada.id).reviews.ready({ ticketId: ticket.id })
    callerFor(rev.id).reviews.setThreadState(thread.id, 'resolved')
    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'Ship it.' })

    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(engine.approvals.list()[0]).toMatchObject({ action: 'merge', ticketId: ticket.id })
  })
})

describe('The round limit', () => {
  it('is 3 by default, and the boss can change it', () => {
    const { engine } = setup()

    expect(engine.reviews.roundLimit()).toBe(3)
    expect(engine.reviews.setRoundLimit(5)).toBe(5)
    expect(engine.reviews.roundLimit()).toBe(5)
    expect(() => engine.reviews.setRoundLimit(0)).toThrow(/whole number from 1/)
  })

  it('hands the ticket to the boss when it is reached, instead of sending it back again', async () => {
    const { engine, ada, rev, callerFor, inReview, round } = setup()
    engine.reviews.setRoundLimit(2)
    const ticket = await inReview()

    await round(ticket.id, 'Wrap this in a try/catch.')
    expect(engine.board().snapshot().tickets[0]).toMatchObject({ column: 'doing' })
    callerFor(ada.id).reviews.ready({ ticketId: ticket.id, summary: 'Pushed the boundary check instead.' })
    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: 'Still wrong.' })

    const review = engine.reviews.of(ticket.id)!
    expect(review).toMatchObject({ handoff: 'your_call', rounds: 2, roundLimit: 2 })
    // Nobody is sent back to work: the ticket waits in review and the boss is asked.
    expect(engine.board().snapshot().tickets[0]).toMatchObject({ column: 'review' })
    expect(engine.inbox.list(ada.id).filter((i) => i.kind === 'review')).toHaveLength(1)
    const approval = engine.approvals.list({ status: 'pending' })[0]
    expect(approval).toMatchObject({ action: 'merge', ticketId: ticket.id })
    expect(approval!.reason).toMatch(/Rev and Ada disagree after 2 rounds/)
    expect(approval!.reason).toMatch(/Still wrong/)
  })

  it('asks the boss at the limit even in an Autonomous Company', async () => {
    const { engine, ada, inReview, round } = setup()
    engine.reviews.setRoundLimit(1)
    engine.approvals.setLevel('autonomous')
    const ticket = await inReview()

    await round(ticket.id)

    expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1)
    expect(engine.reviews.of(ticket.id)).toMatchObject({ handoff: 'your_call' })
    expect(engine.inbox.list(ada.id).filter((i) => i.kind === 'review')).toEqual([])
  })

  it('lets the boss merge as it is, deciding the approval the limit raised', async () => {
    const { engine, git, inReview, round } = setup()
    engine.reviews.setRoundLimit(1)
    const ticket = await inReview()
    await round(ticket.id)
    const approval = engine.approvals.list({ status: 'pending' })[0]!

    engine.reviews.approve(ticket.id, 'Merging as it is.')

    expect(engine.approvals.list()[0]).toMatchObject({ id: approval.id, status: 'approved' })
    await vi.waitFor(() => expect(git.merges).toHaveLength(1))
    await vi.waitFor(() => expect(engine.board().snapshot().tickets[0]).toMatchObject({ column: 'done' }))
  })

  it('sends it back as a round of the boss’s own when they say so', async () => {
    const { engine, ada, inReview, round } = setup()
    engine.reviews.setRoundLimit(1)
    const ticket = await inReview()
    await round(ticket.id)

    engine.reviews.requestChanges(ticket.id, 'Use Rev’s fix.')

    expect(engine.board().snapshot().tickets[0]).toMatchObject({ column: 'doing' })
    const woken = engine.inbox
      .list(ada.id)
      .filter((i) => i.kind === 'review')
      .at(-1)!
    expect(woken.fromId).toBe(BOSS)
    expect(woken.prompt).toContain('Use Rev’s fix.')
  })
})

describe('Waking', () => {
  it('wakes the assignee once per round, with every open thread rather than once per comment', async () => {
    const { engine, ada, rev, callerFor, inReview } = setup()
    const ticket = await inReview()
    const reviewer = callerFor(rev.id).reviews

    reviewer.openThread({ ticketId: ticket.id, path: 'a.ts', line: 3, body: 'Name it.' })
    reviewer.openThread({ ticketId: ticket.id, path: 'b.ts', line: 9, body: 'Drop this.' })
    reviewer.openThread({ ticketId: ticket.id, path: 'c.ts', line: 1, body: 'A note.', blocking: false })
    expect(engine.inbox.list(ada.id).filter((i) => i.kind === 'review')).toEqual([])

    reviewer.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: 'Three things.' })

    const woken = engine.inbox.list(ada.id).filter((i) => i.kind === 'review')
    expect(woken).toHaveLength(1)
    expect(woken[0]!.prompt).toContain('a.ts:3')
    expect(woken[0]!.prompt).toContain('b.ts:9')
    expect(woken[0]!.prompt).toContain('c.ts:1 (non-blocking note)')
    expect(woken[0]!.prompt).toContain('review_ready')
  })

  it('wakes the reviewer once per round, with what the assignee said and what is still open', async () => {
    const { engine, ada, rev, callerFor, inReview, round } = setup()
    const ticket = await inReview()
    const thread = await round(ticket.id, 'Intl throws on an unknown locale.')
    callerFor(ada.id).reviews.replyInThread({ threadId: thread.id, body: 'It is rejected at the boundary.' })

    const review = callerFor(ada.id).reviews.ready({
      ticketId: ticket.id,
      summary: 'Pushed 2 commits for round 1.',
    })

    expect(review).toMatchObject({ round: 2, status: 'pending', reviewerId: rev.id })
    const woken = engine.inbox.list(rev.id).filter((i) => i.kind === 'review')
    expect(woken).toHaveLength(2)
    expect(woken[1]!.prompt).toContain('Pushed 2 commits for round 1.')
    expect(woken[1]!.prompt).toContain('It is rejected at the boundary.')
    expect(woken[1]!.prompt).toContain('src/format/currency.ts:20')
  })

  it('refuses review_ready from anyone but the ticket’s assignee, and while a round is open', async () => {
    const { engine, rev, callerFor, inReview } = setup()
    const ticket = await inReview()

    expect(() => callerFor(rev.id).reviews.ready({ ticketId: ticket.id })).toThrow(/not yours/)
    expect(() => callerFor(engine.employees.list()[0]!.id).reviews.ready({ ticketId: ticket.id })).toThrow(
      /already waiting for a review/,
    )
  })
})
