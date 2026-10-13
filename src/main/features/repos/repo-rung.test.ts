import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTONOMY_LEVELS } from '../../../shared/approvals'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** Acme with one repo per rung, Ada writing and Rev reviewing. */
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
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const stack = readyStack()
  const merges = engine.repos.add({ path: onDisk('/code/merges'), name: 'merges-repo', stack })
  const prOnly = engine.repos.add({ path: onDisk('/code/pr'), name: 'pr-repo', stack, rung: 'pr' })
  const localOnly = engine.repos.add({ path: onDisk('/code/local'), name: 'local-repo', stack, rung: 'local' })

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  const board = () => engine.board()
  const columnOf = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!.column
  const prs = () => engine.chat().read({ channelId: 'prs' })
  const thread = (messageId: number) => engine.chat().read({ channelId: 'prs', threadId: messageId })

  /** A ticket of Ada's in `repoIds`, moved to Review by the boss. */
  function inReview(...repoIds: string[]) {
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: repoIds })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    return ticket
  }

  return { engine, git, ada, merges, prOnly, localOnly, board, columnOf, prs, thread, callerFor, inReview }
}

describe('A repo that may merge', () => {
  it('is what a newly attached repo is, and its ticket opens a PR and merges', async () => {
    const { engine, git, merges, columnOf, inReview } = setup()
    expect(merges.rung).toBe('merge')
    const ticket = inReview(merges.id)

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    engine.reviews.approve(ticket.id)
    await vi.waitFor(() => expect(columnOf(ticket.id)).toBe('done'))

    expect(git.merges).toHaveLength(1)
    expect(engine.reviews.of(ticket.id)).toMatchObject({ merge: 'merged' })
  })
})

describe('A PR only repo', () => {
  it('opens the PR', async () => {
    const { engine, git, prOnly, inReview } = setup()
    const ticket = inReview(prOnly.id)

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    expect(git.pullRequests).toHaveLength(1)
    expect(engine.code.of(ticket.id).localOnly).toBeUndefined()
  })

  it('refuses the merge of an approved review, names the repo and the rung, and leaves the PR open', async () => {
    const { engine, git, prOnly, columnOf, thread, inReview } = setup()
    const ticket = inReview(prOnly.id)
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    engine.reviews.approve(ticket.id)

    expect(git.merges).toEqual([])
    expect(engine.reviews.of(ticket.id)).toMatchObject({
      status: 'approved',
      merge: 'refused',
      mergeError:
        'pr-repo is PR only. TinyCorp opens the PR and never merges it; the PR stays open for someone with ' +
        'the rights to merge it.',
    })
    expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1)
    expect(columnOf(ticket.id)).toBe('review')
    const round = engine.reviews.of(ticket.id)!
    expect(thread(round.messageId).at(-1)).toMatchObject({
      authorId: COMPANY_AUTHOR,
      text:
        'pr-repo is PR only. TinyCorp opens the PR and never merges it; the PR stays open for someone with ' +
        'the rights to merge it. The PRs stay open and the ticket waits in review.',
    })
  })

  it('is never merged at any autonomy level, Autonomous included', async () => {
    for (const level of AUTONOMY_LEVELS) {
      const { engine, git, prOnly, inReview } = setup()
      engine.approvals.setLevel(level)
      const ticket = inReview(prOnly.id)
      await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

      engine.reviews.approve(ticket.id)

      expect(git.merges, `merged under ${level}`).toEqual([])
      expect(engine.reviews.of(ticket.id)?.merge, level).toBe('refused')
      expect(
        engine.approvals.list().filter((a) => a.action === 'merge'),
        level,
      ).toEqual([])
    }
  })

  it('refuses an Employee asking to merge, rather than putting the question to the boss', async () => {
    const { engine, prOnly, callerFor, ada, inReview } = setup()
    const ticket = inReview(prOnly.id)
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    expect(() =>
      callerFor(ada.id).approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id }),
    ).toThrow(/pr-repo is PR only/)
    expect(engine.approvals.list()).toEqual([])
  })
})

describe('A local only repo', () => {
  it('still gets a worktree and a branch', () => {
    const { engine, git, localOnly, board, ada } = setup()
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [localOnly.id] })

    board().moveTicket(ticket.id, 'doing')

    expect(git.worktrees).toHaveLength(1)
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('opens no PR in Review, says why in #prs and starts no review round', async () => {
    const { engine, git, localOnly, columnOf, prs, inReview } = setup()

    const ticket = inReview(localOnly.id)
    await Promise.resolve()

    expect(git.pullRequests).toEqual([])
    expect(engine.reviews.list()).toEqual([])
    expect(engine.code.of(ticket.id)).toMatchObject({ pullRequests: [], localOnly: [localOnly.id] })
    expect(columnOf(ticket.id)).toBe('review')
    expect(prs()).toEqual([
      expect.objectContaining({
        authorId: COMPANY_AUTHOR,
        text:
          `No PR for AC-${ticket.id} Login page. local-repo is local only. TinyCorp never pushes or merges ` +
          'there; the work stays in its worktree and the boss takes it from there.',
      }),
    ])
  })

  it('is not merged by the app either, and the refusal names the repo and the rung', async () => {
    const { engine, git, localOnly, ada, callerFor, inReview } = setup()
    const ticket = inReview(localOnly.id)

    await expect(callerFor(ada.id).merges.merge(ticket.id)).rejects.toThrow(
      'local-repo is local only. TinyCorp never pushes or merges there; the work stays in its worktree and ' +
        'the boss takes it from there.',
    )
    expect(git.localMerges).toEqual([])
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('does not hold the review of the repos beside it that do open a PR', async () => {
    const { engine, merges, localOnly, inReview } = setup()

    const ticket = inReview(merges.id, localOnly.id)

    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    expect(engine.reviews.of(ticket.id)).toMatchObject({ status: 'pending' })
    expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1)
  })

  it('keeps its worktree when the merge of the repo beside it goes through', async () => {
    const { engine, git, merges, localOnly, columnOf, prs, inReview } = setup()
    const ticket = inReview(merges.id, localOnly.id)
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())

    engine.reviews.approve(ticket.id)
    await vi.waitFor(() => expect(columnOf(ticket.id)).toBe('done'))

    expect(git.merges).toHaveLength(1)
    expect(git.removed.map((w) => w.repoPath)).toEqual([onDisk('/code/merges')])
    expect(engine.code.of(ticket.id).worktrees.map((w) => w.repoId)).toEqual([localOnly.id])
    expect(prs().at(-1)!.text).toContain('that worktree stays for you')
  })
})

describe('A repo moved down the ladder while work is in flight', () => {
  it('keeps the open PR open and refuses the next merge', async () => {
    const { engine, git, merges, columnOf, inReview } = setup()
    const ticket = inReview(merges.id)
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    engine.repos.update(merges.id, { rung: 'pr' })
    engine.reviews.approve(ticket.id)

    expect(git.merges).toEqual([])
    expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1)
    expect(columnOf(ticket.id)).toBe('review')
    expect(engine.reviews.of(ticket.id)).toMatchObject({
      merge: 'refused',
      mergeError: expect.stringContaining('merges-repo is PR only'),
    })
  })

  it('refuses a merge approval the boss approves after the move, and merges nothing', async () => {
    const { engine, git, localOnly, ada, callerFor, prs, board } = setup()
    const open = engine.repos.add({ path: onDisk('/code/open'), name: 'open-repo', stack: readyStack() })
    git.withoutRemote(onDisk('/code/open'))
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [open.id] })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    engine.approvals.setLevel('supervised')
    callerFor(ada.id).approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id })
    const [approval] = engine.approvals.list({ status: 'pending' })

    engine.repos.update(open.id, { rung: 'local' })
    engine.approvals.decide(approval!.id, { approve: true })
    await Promise.resolve()

    expect(git.localMerges).toEqual([])
    expect(prs().at(-1)!.text).toContain('open-repo is local only')
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
    expect(localOnly.rung).toBe('local')
  })
})
