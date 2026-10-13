import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepoRung } from '../../../shared/repos/repo'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

/**
 * Two refusals stand in front of every merge, and either one alone stops it: the repo's rung, which
 * the boss chose (decision 61), and the forge, a fact about the repo's `origin` (decision 59). Past
 * both, the autonomy level decides when the boss is asked. Where both refuse, the rung is named.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const RUNG_REFUSAL = /code is PR only\. TinyCorp opens the PR and never merges it/
const FORGE_REFUSAL = /No adapter for gitlab\.example\.com/

/** Acme under `level` with one repo, `code`, at `rung`; Ada writes, Rev reviews. */
function setup({ rung = 'merge', level = 'autonomous' }: { rung?: RepoRung; level?: 'managed' | 'autonomous' } = {}) {
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
  engine.approvals.setLevel(level)
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const code = engine.repos.add({ path: onDisk('/code/code'), name: 'code', stack: readyStack(), rung })
  const board = () => engine.board()
  const column = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)?.column

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  function inReview() {
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [code.id] })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    return ticket
  }

  /** Rev approves the round; the merge goes through the review flow and the forge adapter. */
  async function approveThePullRequest() {
    const ticket = inReview()
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.reviewerId).toBe(rev.id))
    return ticket
  }

  return { engine, git, ada, rev, code, column, callerFor, inReview, approveThePullRequest }
}

describe('A merge through a PR', () => {
  it('goes through only with `merges`, a forge TinyCorp has an adapter for, and a level that lets it', async () => {
    const { engine, git, rev, column, callerFor, approveThePullRequest } = setup()
    const ticket = await approveThePullRequest()

    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    await vi.waitFor(() => expect(column(ticket.id)).toBe('done'))
    expect(git.merges).toHaveLength(1)
    expect(engine.reviews.of(ticket.id)).toMatchObject({ merge: 'merged' })
  })

  it('is refused by the rung alone, and names the rung', async () => {
    const { engine, git, rev, column, callerFor, approveThePullRequest } = setup({ rung: 'pr' })
    const ticket = await approveThePullRequest()

    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    expect(engine.reviews.of(ticket.id)).toMatchObject({
      merge: 'refused',
      mergeError: expect.stringMatching(RUNG_REFUSAL),
    })
    expect(git.merges).toEqual([])
    expect(engine.approvals.list()).toEqual([])
    expect(column(ticket.id)).toBe('review')
  })

  it('is refused by the forge alone — the origin moved to a host with no adapter — and names the forge', async () => {
    const { engine, git, rev, column, callerFor, approveThePullRequest } = setup()
    const ticket = await approveThePullRequest()
    git.withoutForge(onDisk('/code/code'), 'gitlab.example.com')

    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    const round = engine.reviews.of(ticket.id)!
    expect(round).toMatchObject({ merge: 'refused', mergeError: expect.stringMatching(FORGE_REFUSAL) })
    expect(round.mergeError).toMatch(/^code cannot be merged from here/)
    expect(git.merges).toEqual([])
    expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1)
    expect(column(ticket.id)).toBe('review')
  })

  it('names the rung, not the forge, when both refuse: the rung is what the boss chose', async () => {
    const { engine, git, rev, callerFor, approveThePullRequest } = setup({ rung: 'pr' })
    const ticket = await approveThePullRequest()
    git.withoutForge(onDisk('/code/code'), 'gitlab.example.com')

    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    expect(engine.reviews.of(ticket.id)?.mergeError).toMatch(RUNG_REFUSAL)
    expect(engine.reviews.of(ticket.id)?.mergeError).not.toMatch(FORGE_REFUSAL)
    expect(git.merges).toEqual([])
  })

  it('waits for the boss when the level asks, even with `merges` and a forge that can merge', async () => {
    const { engine, git, rev, callerFor, approveThePullRequest } = setup({ level: 'managed' })
    const ticket = await approveThePullRequest()

    callerFor(rev.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).toMatchObject({ merge: 'waiting' }))
    expect(git.merges).toEqual([])
  })
})

describe('A local merge, through the merge gate', () => {
  it('is refused by the rung alone, in a repo whose missing origin would let it merge here', async () => {
    for (const rung of ['pr', 'local'] as const) {
      const { engine, git, ada, column, callerFor, inReview } = setup({ rung })
      git.withoutRemote(onDisk('/code/code'))
      const ticket = inReview()

      await expect(callerFor(ada.id).merges.merge(ticket.id), rung).rejects.toThrow(/^code is (PR only|local only)\./)
      expect(git.localMerges, rung).toEqual([])
      expect(column(ticket.id), rung).toBe('review')
      expect(engine.code.of(ticket.id).worktrees, rung).toHaveLength(1)
    }
  })

  it('is refused by the forge alone, with `merges` and Autonomous, and names the forge', async () => {
    const { git, ada, column, callerFor, inReview } = setup()
    git.withoutForge(onDisk('/code/code'), 'gitlab.example.com')
    const ticket = inReview()

    await expect(callerFor(ada.id).merges.merge(ticket.id)).rejects.toThrow(
      /cannot be merged here: No adapter for gitlab\.example\.com/,
    )
    expect(git.localMerges).toEqual([])
    expect(column(ticket.id)).toBe('review')
  })

  it('names the rung, not the forge, when both refuse', async () => {
    const { git, ada, callerFor, inReview } = setup({ rung: 'pr' })
    git.withoutForge(onDisk('/code/code'), 'gitlab.example.com')
    const ticket = inReview()

    await expect(callerFor(ada.id).merges.merge(ticket.id)).rejects.toThrow(RUNG_REFUSAL)
    expect(git.localMerges).toEqual([])
  })

  it('is refused by the level alone, with `merges` and no origin', async () => {
    const { git, ada, callerFor, inReview } = setup({ level: 'managed' })
    git.withoutRemote(onDisk('/code/code'))
    const ticket = inReview()

    await expect(callerFor(ada.id).merges.merge(ticket.id)).rejects.toThrow(/needs an approved merge approval/)
    expect(git.localMerges).toEqual([])
  })

  it('goes through with `merges`, no origin — the fact of decision 44 — and a level that lets it', async () => {
    const { git, ada, column, callerFor, inReview } = setup()
    git.withoutRemote(onDisk('/code/code'))
    const ticket = inReview()

    await callerFor(ada.id).merges.merge(ticket.id)

    expect(git.localMerges).toHaveLength(1)
    expect(column(ticket.id)).toBe('done')
  })
})
