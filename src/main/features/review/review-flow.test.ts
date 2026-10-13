import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

function setup({ reviewer = true }: { reviewer?: boolean } = {}) {
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
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = reviewer ? engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] }) : null
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: node })

  /** What an Employee can do over MCP. */
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
  const thread = (messageId: number) => engine.chat().read({ channelId: 'prs', threadId: messageId })

  /** A ticket of Ada's in both repos, moved to Review by the boss, with both PRs open. */
  async function inReview() {
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }

  return { engine, git, ada, rev, web, api, board, ticketOf, prs, thread, callerFor, inReview }
}

describe('Review routing', () => {
  it('routes a ticket’s PRs to an Employee holding review, who is told how to review read-only', async () => {
    const { engine, rev, ada, prs, inReview } = setup()

    const ticket = await inReview()

    const [web, api] = engine.code.of(ticket.id).pullRequests
    expect(engine.reviews.of(ticket.id)).toMatchObject({
      ticketId: ticket.id,
      reviewerId: rev!.id,
      status: 'pending',
      merge: null,
    })
    expect(prs().at(-1)).toMatchObject({
      authorId: COMPANY_AUTHOR,
      text: expect.stringMatching(new RegExp(`Review requested from Rev for AC-${ticket.id} Login page`)),
    })
    const item = engine.inbox.list(rev!.id).at(-1)!
    expect(item).toMatchObject({ kind: 'review', ticketId: ticket.id, fromId: ada.id })
    expect(item.prompt).toMatch(/^\[company\] /)
    expect(item.prompt).toContain(web!.url)
    expect(item.prompt).toContain(api!.url)
    expect(item.prompt).toContain(`${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`)
    expect(item.prompt).toMatch(/read-only/i)
    expect(item.prompt).toContain('review_submit')
  })

  it('sends the PRs straight to the boss when nobody else holds review', async () => {
    const { engine, git, ada, prs, inReview } = setup({ reviewer: false })
    engine.employees.update(ada.id, { capabilities: ['code', 'review'] })

    const ticket = await inReview()

    expect(engine.reviews.of(ticket.id)).toMatchObject({ reviewerId: BOSS, status: 'pending' })
    expect(prs().at(-1)!.text).toMatch(new RegExp(`Review requested from @boss for AC-${ticket.id}`))
    expect(engine.inbox.list(ada.id).some((i) => i.kind === 'review')).toBe(false)
    expect(engine.approvals.list()).toEqual([])
    expect(git.merges).toEqual([])
  })

  it('asks for no review while a PR is missing', async () => {
    const { engine, git, ada, web, api, board, prs } = setup()
    git.failPullRequest(onDisk('/work/acme/worktrees/api/'), 'No commits between main and the branch')
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })
    board().moveTicket(ticket.id, 'doing')
    const docs = board().createTicket({ title: 'Docs', repos: [web.id] })

    board().moveTicket(ticket.id, 'review')
    board().moveTicket(docs.id, 'review')

    await vi.waitFor(() => expect(prs().some((m) => /Could not open/.test(m.text))).toBe(true))
    expect(engine.reviews.list()).toEqual([])
  })

  it('asks for no second review while one is pending', async () => {
    const { engine, rev, board, inReview } = setup()
    const ticket = await inReview()

    board().moveTicket(ticket.id, 'review', 0)
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(engine.reviews.list()).toHaveLength(1)
    expect(engine.inbox.list(rev!.id).filter((i) => i.kind === 'review')).toHaveLength(1)
  })
})

describe('Reviewer verdict', () => {
  it('bounces the ticket back to its assignee with the comments, and reviews it again when it returns', async () => {
    const { engine, git, ada, rev, ticketOf, thread, callerFor, inReview } = setup()
    const ticket = await inReview()
    const [web] = engine.code.of(ticket.id).pullRequests

    const review = callerFor(rev!.id).reviews.submit({
      ticketId: ticket.id,
      verdict: 'request_changes',
      comments: 'Validate the email.',
    })

    expect(review).toMatchObject({ status: 'changes_requested', decidedBy: rev!.id, comments: 'Validate the email.' })
    expect(ticketOf(ticket.id).column).toBe('doing')
    const item = engine.inbox.list(ada.id).at(-1)!
    expect(item).toMatchObject({ kind: 'review', ticketId: ticket.id, fromId: rev!.id })
    expect(item.prompt).toContain('Validate the email.')
    expect(item.prompt).toContain('review_ready')
    expect(thread(review.messageId).at(-1)!.text).toMatch(/Rev requested changes.*Validate the email\./s)
    // The round goes on each PR as one review, not as a comment (T170).
    await vi.waitFor(() => expect(git.reviews).toHaveLength(2))
    expect(git.reviews[0]).toMatchObject({
      repoPath: onDisk('/code/web'),
      url: web!.url,
      verdict: 'changes',
      summary: expect.stringMatching(/Rev requested changes[\s\S]*Validate the email\./),
    })

    callerFor(ada.id).board.moveTicket(ticket.id, 'review')

    expect(engine.reviews.of(ticket.id)).toMatchObject({ reviewerId: rev!.id, status: 'pending' })
    expect(engine.reviews.list()).toHaveLength(1)
    expect(git.pullRequests).toHaveLength(2)
    expect(engine.inbox.list(rev!.id).filter((i) => i.kind === 'review')).toHaveLength(2)
  })

  it('numbers a ticket’s rounds from one, whatever the review table’s own row ids are', async () => {
    const { engine, ada, rev, callerFor, inReview } = setup()
    // A second ticket takes review rows of its own, so a row id is never the round of its ticket.
    const other = await inReview()
    const ticket = await inReview()
    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: 'Validate it.' })

    callerFor(ada.id).board.moveTicket(ticket.id, 'review')

    const second = engine.reviews.of(ticket.id)!
    expect(second).toMatchObject({ round: 2, rounds: 2 })
    expect(second.id).toBeGreaterThan(second.round)
    expect(engine.reviews.of(other.id)).toMatchObject({ round: 1, rounds: 1 })
  })

  it('forwards an approval as a merge request that waits for the boss under Managed', async () => {
    const { engine, git, rev, ticketOf, callerFor, inReview } = setup()
    const ticket = await inReview()

    const review = callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    expect(review.status).toBe('approved')
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(engine.approvals.list()[0]).toMatchObject({
      action: 'merge',
      requesterId: rev!.id,
      subject: `AC-${ticket.id} Login page`,
    })
    expect(engine.reviews.of(ticket.id)).toMatchObject({ merge: 'waiting', approvalId: engine.approvals.list()[0]!.id })
    expect(git.merges).toEqual([])
    expect(ticketOf(ticket.id).column).toBe('review')
  })

  it('refuses a verdict from anyone but the assigned reviewer, twice, or without comments on changes', async () => {
    const { ada, rev, callerFor, inReview } = setup()
    const ticket = await inReview()

    expect(() => callerFor(ada.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })).toThrow(
      /Rev/,
    )
    expect(() =>
      callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'request_changes', comments: ' ' }),
    ).toThrow(/comment/i)
    expect(() => callerFor(rev!.id).reviews.submit({ ticketId: 999, verdict: 'approve', comments: '' })).toThrow(
      /AC-999/,
    )
    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })
    expect(() => callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })).toThrow(
      /not waiting for a review/i,
    )
  })
})

describe('Gated merge', () => {
  it('merges every PR on the boss’s approval, removes the worktrees and moves the ticket to Done', async () => {
    const { engine, git, rev, ticketOf, prs, callerFor, inReview } = setup()
    const ticket = await inReview()
    const [web, api] = engine.code.of(ticket.id).pullRequests
    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))

    engine.approvals.decide(engine.approvals.list()[0]!.id, { approve: true })

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(git.merges).toEqual([
      { repoPath: onDisk('/code/web'), url: web!.url },
      { repoPath: onDisk('/code/api'), url: api!.url },
    ])
    expect(git.removed).toEqual([
      {
        repoPath: onDisk('/code/web'),
        path: `${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`,
        branch: `ticket-ac-${ticket.id}-login-page`,
      },
      expect.objectContaining({ repoPath: onDisk('/code/api') }),
    ])
    expect(engine.code.of(ticket.id)).toMatchObject({ worktrees: [], pullRequests: [web, api] })
    expect(engine.code.brief(ticket.id)).toBeNull()
    expect(engine.reviews.of(ticket.id)).toMatchObject({
      merge: 'merged',
      mergedRepoIds: [web!.repoId, api!.repoId],
    })
    expect(prs().at(-1)).toMatchObject({
      authorId: COMPANY_AUTHOR,
      text: expect.stringMatching(new RegExp(`Merged AC-${ticket.id} Login page.*web.*api`, 's')),
    })
  })

  it('bounces the ticket back with the boss’s reason when the merge is rejected', async () => {
    const { engine, git, ada, rev, ticketOf, callerFor, inReview } = setup()
    const ticket = await inReview()
    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))

    engine.approvals.decide(engine.approvals.list()[0]!.id, { approve: false, reason: 'Add a test first.' })
    await Promise.resolve()

    expect(git.merges).toEqual([])
    expect(engine.reviews.of(ticket.id)).toMatchObject({ merge: 'rejected' })
    expect(ticketOf(ticket.id).column).toBe('doing')
    expect(engine.inbox.list(ada.id).at(-1)).toMatchObject({ kind: 'review', fromId: BOSS })
    expect(engine.inbox.list(ada.id).at(-1)!.prompt).toContain('Add a test first.')
    expect(engine.inbox.list(rev!.id).at(-1)).toMatchObject({ kind: 'approval' })
  })

  it('merges without asking under Autonomous, unless CI is red', async () => {
    const { engine, git, rev, ticketOf, callerFor, inReview } = setup()
    engine.approvals.setLevel('autonomous')
    const green = await inReview()
    callerFor(rev!.id).reviews.submit({ ticketId: green.id, verdict: 'approve', comments: '' })
    await vi.waitFor(() => expect(ticketOf(green.id).column).toBe('done'))
    expect(engine.approvals.list()).toEqual([])

    const red = await inReview()
    git.setChecks(engine.code.of(red.id).pullRequests[1]!.url, 'failing')
    callerFor(rev!.id).reviews.submit({ ticketId: red.id, verdict: 'approve', comments: '' })

    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(engine.approvals.list()[0]).toMatchObject({ action: 'merge', subject: `AC-${red.id} Login page` })
    expect(engine.approvals.list()[0]!.reason).toMatch(/CI is failing/)
    expect(ticketOf(red.id).column).toBe('review')
  })

  it('always asks under Supervised', async () => {
    const { engine, git, rev, callerFor, inReview } = setup()
    engine.approvals.setLevel('supervised')
    const ticket = await inReview()

    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: '' })

    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(git.merges).toEqual([])
  })

  it('lets the boss approve a PR routed to them, which merges it at once', async () => {
    const { engine, git, ticketOf, inReview } = setup({ reviewer: false })
    const ticket = await inReview()

    const review = engine.reviews.approve(ticket.id, 'Ship it')

    expect(review).toMatchObject({ status: 'approved', decidedBy: BOSS, comments: 'Ship it' })
    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(git.merges).toHaveLength(2)
    expect(engine.approvals.list()).toEqual([])
  })

  it('lets the boss request changes on a PR routed to them', async () => {
    const { engine, git, ada, ticketOf, inReview } = setup({ reviewer: false })
    const ticket = await inReview()

    engine.reviews.requestChanges(ticket.id, 'Rename the route.')

    expect(ticketOf(ticket.id).column).toBe('doing')
    expect(engine.inbox.list(ada.id).at(-1)!.prompt).toContain('Rename the route.')
    expect(git.merges).toEqual([])
    expect(() => engine.reviews.requestChanges(ticket.id, 'Again')).toThrow(/not in review/i)
  })

  it('lets the boss step in on a review an Employee has not given yet', async () => {
    const { engine, git, rev, ticketOf, inReview } = setup()
    const ticket = await inReview()

    engine.reviews.approve(ticket.id)

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(engine.reviews.of(ticket.id)).toMatchObject({ reviewerId: rev!.id, decidedBy: BOSS })
    expect(git.merges).toHaveLength(2)
  })

  it('decides a pending merge Approval when the boss acts from the ticket instead of the thread', async () => {
    const { engine, git, ada, rev, ticketOf, callerFor, inReview } = setup()
    const merged = await inReview()
    callerFor(rev!.id).reviews.submit({ ticketId: merged.id, verdict: 'approve', comments: '' })
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))

    engine.reviews.approve(merged.id, 'Go')

    await vi.waitFor(() => expect(ticketOf(merged.id).column).toBe('done'))
    expect(engine.approvals.list()).toEqual([expect.objectContaining({ status: 'approved', decisionReason: 'Go' })])
    expect(git.merges).toHaveLength(2)

    const bounced = await inReview()
    callerFor(rev!.id).reviews.submit({ ticketId: bounced.id, verdict: 'approve', comments: '' })
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))

    engine.reviews.requestChanges(bounced.id, 'Split it.')

    expect(engine.approvals.list().at(-1)).toMatchObject({ status: 'rejected', decisionReason: 'Split it.' })
    expect(engine.reviews.of(bounced.id)).toMatchObject({ merge: 'rejected' })
    expect(ticketOf(bounced.id).column).toBe('doing')
    expect(engine.inbox.list(ada.id).at(-1)!.prompt).toContain('Split it.')
  })

  it('keeps the ticket in Review when a merge fails, and merges only what is left when the boss retries', async () => {
    const { engine, git, ticketOf, prs, inReview } = setup({ reviewer: false })
    const ticket = await inReview()
    const [web, api] = engine.code.of(ticket.id).pullRequests
    git.failMerge(api!.url, 'Pull request is not mergeable')

    engine.reviews.approve(ticket.id)

    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.merge).toBe('failed'))
    expect(engine.reviews.of(ticket.id)).toMatchObject({
      mergedRepoIds: [web!.repoId],
      mergeError: expect.stringContaining('not mergeable'),
    })
    expect(prs().at(-1)!.text).toMatch(new RegExp(`Could not merge AC-${ticket.id} Login page in api.*not mergeable`))
    expect(ticketOf(ticket.id).column).toBe('review')
    expect(git.removed).toEqual([])

    git.clearMergeFailure(api!.url)
    engine.reviews.approve(ticket.id)

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(git.merges.map((m) => m.url)).toEqual([web!.url, api!.url, api!.url])
    expect(engine.reviews.list()).toHaveLength(1)
  })

  it('asks GitHub again when the base moved under a merge, and merges (T276)', async () => {
    const { engine, git, ticketOf, inReview } = setup({ reviewer: false })
    const ticket = await inReview()
    const [web, api] = engine.code.of(ticket.id).pullRequests
    git.failMerge(api!.url, 'GraphQL: Base branch was modified. Review and try the merge again.', 1)

    engine.reviews.approve(ticket.id)

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'), { timeout: 3_000 })
    expect(git.merges.map((m) => m.url)).toEqual([web!.url, api!.url, api!.url])
  })

  it('says what to do after a merge fails, and merges again when the assignee asks (T276)', async () => {
    const { engine, git, ada, ticketOf, prs, callerFor, inReview } = setup({ reviewer: false })
    const ticket = await inReview()
    const api = engine.code.of(ticket.id).pullRequests[1]!
    git.failMerge(api.url, 'GraphQL: Pull Request has merge conflicts (mergePullRequest)', 1)
    engine.reviews.approve(ticket.id)
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.merge).toBe('failed'))
    expect(prs().at(-1)!.text).toContain('then call merge_retry; the boss can also press Retry merge on the ticket.')
    // #prs wakes nobody: the holder is told, since only the holder can bring the branch up to date (T277).
    expect(engine.inbox.list(ada.id).at(-1)).toMatchObject({
      kind: 'review',
      ticketId: ticket.id,
      prompt: expect.stringContaining(`and push, then call merge_retry for AC-${ticket.id}.`),
    })

    // Managed asks the boss again, and the approval is the round's own.
    expect(callerFor(ada.id).reviews.retryMerge(ticket.id)).toMatchObject({ merge: 'waiting' })
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
  })

  it('merges again at once when the level lets it through, and refuses a merge that never failed (T276)', async () => {
    const { engine, git, ada, ticketOf, callerFor, inReview } = setup({ reviewer: false })
    engine.approvals.setLevel('autonomous')
    const ticket = await inReview()
    expect(() => callerFor(ada.id).reviews.retryMerge(ticket.id)).toThrow(
      `AC-${ticket.id} has no failed merge to try again`,
    )
    const api = engine.code.of(ticket.id).pullRequests[1]!
    git.failMerge(api.url, 'GraphQL: Pull Request has merge conflicts (mergePullRequest)', 1)
    engine.reviews.approve(ticket.id)
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.merge).toBe('failed'))

    callerFor(ada.id).reviews.retryMerge(ticket.id)

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
    expect(engine.approvals.list()).toEqual([])
  })

  it('merges again when the boss approves an Employee’s own request for a merge that failed (T276)', async () => {
    const { engine, git, ada, ticketOf, inReview } = setup({ reviewer: false })
    const ticket = await inReview()
    const api = engine.code.of(ticket.id).pullRequests[1]!
    git.failMerge(api.url, 'GraphQL: Pull Request has merge conflicts (mergePullRequest)', 1)
    engine.reviews.approve(ticket.id)
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.merge).toBe('failed'))

    // approval_request rather than merge_retry: not the round's approval, but the boss's yes all the same.
    engine.approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id, reason: 'Conflicts fixed.' })
    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })

    await vi.waitFor(() => expect(ticketOf(ticket.id).column).toBe('done'))
  })

  it('refuses to merge a ticket that is not in review or is already merging', async () => {
    const { engine, board, inReview } = setup({ reviewer: false })
    const todo = board().createTicket({ title: 'Later' })
    expect(() => engine.reviews.approve(todo.id)).toThrow(/not in review/i)

    const ticket = await inReview()
    engine.reviews.approve(ticket.id)
    expect(() => engine.reviews.approve(ticket.id)).toThrow(/already merging/i)
  })

  it('tells listeners when a review changes', async () => {
    const { engine, inReview } = setup()
    const changed = vi.fn()
    engine.reviews.onChange(changed)

    await inReview()

    expect(changed).toHaveBeenCalled()
  })
})
