import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_REMOTE, NO_REMOTE_BADGE } from '../../../shared/code'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/**
 * Acme with `web` (no remote), `infra` (an `origin` on a forge TinyCorp has no adapter for) and
 * `api` (a forge it does have one for), and Ada holding tickets across them.
 */
function setup() {
  const provider = fakeProvider()
  const git = fakeGit()
  git.withoutRemote(onDisk('/code/web'))
  git.withoutForge(onDisk('/code/infra'), 'gitlab.example.com')
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
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
  const infra = engine.repos.add({ path: onDisk('/code/infra'), name: 'infra', stack: readyStack() })
  const board = () => engine.board()
  const prs = () => engine.chat().read({ channelId: 'prs' })

  function boardAsAda() {
    if (engine.sessions.get(ada.id).status === 'off') engine.sessions.start(ada.id)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(ada.id).mcp!.token)
    if (!caller) throw new Error('Ada has no MCP caller')
    return caller.board
  }

  const ticketIn = (...repos: string[]) => board().createTicket({ title: 'Login page', assigneeId: ada.id, repos })

  return { engine, git, ada, web, api, infra, board, boardAsAda, prs, ticketIn }
}

describe('A repo without a remote', () => {
  it('still gets a worktree and branch per ticket', () => {
    const { engine, git, web, board, ticketIn } = setup()
    const ticket = ticketIn(web.id)

    board().moveTicket(ticket.id, 'doing')

    expect(git.worktrees).toEqual([
      expect.objectContaining({ repoPath: onDisk('/code/web'), branch: `ticket-ac-${ticket.id}-login-page` }),
    ])
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('refuses the PR in Review with a clear message instead of failing', async () => {
    const { engine, git, ada, web, board, prs, ticketIn } = setup()
    const ticket = ticketIn(web.id)
    board().moveTicket(ticket.id, 'doing')

    board().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(git.pullRequests).toEqual([])
    expect(prs()).toEqual([
      expect.objectContaining({
        authorId: COMPANY_AUTHOR,
        text: `${NO_REMOTE} for AC-${ticket.id} Login page in web: add an origin remote to ${onDisk('/code/web')}, then move the ticket to Review again.`,
      }),
    ])
    expect(engine.code.of(ticket.id)).toMatchObject({
      pullRequests: [],
      withoutPullRequest: [{ repoId: web.id, badge: NO_REMOTE_BADGE, reason: NO_REMOTE }],
    })
    expect(
      engine
        .board()
        .snapshot()
        .tickets.find((t) => t.id === ticket.id)?.column,
    ).toBe('review')
    expect(engine.inbox.list(ada.id).at(-1)?.text).toContain(NO_REMOTE)
  })

  it('opens the PRs of the repos that have a remote', async () => {
    const { engine, git, web, api, board, ticketIn } = setup()
    const ticket = ticketIn(web.id, api.id)
    board().moveTicket(ticket.id, 'doing')

    board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    expect(git.pullRequests.map((pr) => pr.path)).toEqual([
      `${onDisk('/work/acme/worktrees/api/ticket-ac-')}${ticket.id}-login-page`,
    ])
    expect(engine.code.of(ticket.id)).toMatchObject({ withoutPullRequest: [{ repoId: web.id }] })
    expect(engine.reviews.list()).toEqual([])
  })

  it('asks no approval for PRs that cannot be opened', async () => {
    const { engine, web, boardAsAda, prs, ticketIn } = setup()
    const ticket = ticketIn(web.id)
    boardAsAda().moveTicket(ticket.id, 'doing')

    boardAsAda().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(engine.approvals.list()).toEqual([])
    expect(prs()[0]!.text).toContain(NO_REMOTE)
  })

  it('lists no repo as unable to open a PR when every repo can', () => {
    const { engine, api, board, ticketIn } = setup()
    const ticket = ticketIn(api.id)
    board().moveTicket(ticket.id, 'doing')

    expect(engine.code.of(ticket.id).withoutPullRequest).toBeUndefined()
  })
})

/**
 * A repo whose `origin` is on a forge nobody has written an adapter for. It is attached, it works
 * for everything local, and the one thing it cannot do it says in words — on the ticket, in `#prs`
 * and in the Employee's own instructions — rather than failing when the work is already done.
 */
describe('A repo on a forge TinyCorp has no adapter for', () => {
  const NO_ADAPTER = 'No adapter for gitlab.example.com, cannot open a PR'

  it('still gets a worktree and a branch per ticket', () => {
    const { engine, git, infra, board, ticketIn } = setup()
    const ticket = ticketIn(infra.id)

    board().moveTicket(ticket.id, 'doing')

    expect(git.worktrees).toEqual([
      expect.objectContaining({ repoPath: onDisk('/code/infra'), branch: `ticket-ac-${ticket.id}-login-page` }),
    ])
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('refuses the PR in Review, naming the forge and where the branch is', async () => {
    const { engine, git, ada, infra, board, prs, ticketIn } = setup()
    const ticket = ticketIn(infra.id)
    board().moveTicket(ticket.id, 'doing')

    board().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(git.pullRequests).toEqual([])
    expect(prs()[0]!.text).toBe(
      `${NO_ADAPTER} for AC-${ticket.id} Login page in infra: the work is committed on ` +
        `ticket-ac-${ticket.id}-login-page in ${onDisk('/work/acme/worktrees/infra/ticket-ac-')}${ticket.id}-login-page — ` +
        'push it and open the PR yourself.',
    )
    expect(engine.code.of(ticket.id)).toMatchObject({
      pullRequests: [],
      withoutPullRequest: [{ repoId: infra.id, badge: 'No forge', reason: NO_ADAPTER }],
    })
    expect(
      engine
        .board()
        .snapshot()
        .tickets.find((t) => t.id === ticket.id)?.column,
    ).toBe('review')
    expect(engine.inbox.list(ada.id).at(-1)?.text).toContain(NO_ADAPTER)
  })

  it('opens the PRs of the repos it does have an adapter for, in the same ticket', async () => {
    const { engine, git, api, infra, board, ticketIn } = setup()
    const ticket = ticketIn(infra.id, api.id)
    board().moveTicket(ticket.id, 'doing')

    board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    expect(git.pullRequests.map((pr) => pr.path)).toEqual([
      `${onDisk('/work/acme/worktrees/api/ticket-ac-')}${ticket.id}-login-page`,
    ])
    expect(engine.code.of(ticket.id)).toMatchObject({ withoutPullRequest: [{ repoId: infra.id }] })
  })
})
