import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

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
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: node })

  /** The board as Ada uses it over MCP. */
  function boardAsAda() {
    if (engine.sessions.get(ada.id).status === 'off') engine.sessions.start(ada.id)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(ada.id).mcp!.token)
    if (!caller) throw new Error('Ada has no MCP caller')
    return caller.board
  }

  const board = () => engine.board()
  const prs = () => engine.chat().read({ channelId: 'prs' })
  const loginTicket = () => board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })

  return { engine, git, acme, ada, web, api, board, boardAsAda, prs, loginTicket }
}

describe('Worktree per ticket', () => {
  it('gives a ticket a worktree and branch per repo in scope when it is claimed', () => {
    const { engine, git, ada, web, api, board, loginTicket } = setup()
    const ticket = loginTicket()

    board().moveTicket(ticket.id, 'doing')

    expect(engine.code.of(ticket.id).worktrees).toEqual([
      expect.objectContaining({
        ticketId: ticket.id,
        repoId: web.id,
        path: `${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`,
        branch: `ticket-ac-${ticket.id}-login-page`,
        base: 'main',
      }),
      expect.objectContaining({
        ticketId: ticket.id,
        repoId: api.id,
        path: `${onDisk('/work/acme/worktrees/api/ticket-ac-')}${ticket.id}-login-page`,
        branch: `ticket-ac-${ticket.id}-login-page`,
      }),
    ])
    expect(git.worktrees.map((w) => w.repoPath)).toEqual([onDisk('/code/web'), onDisk('/code/api')])
    expect(engine.inbox.list(ada.id).at(-1)).toMatchObject({ kind: 'ticket', ticketId: ticket.id })
  })

  it('tells the assignee its new directories in the ticket prompt', () => {
    const { engine, ada, board, loginTicket } = setup()
    const ticket = loginTicket()

    board().moveTicket(ticket.id, 'doing')

    const prompt = engine.inbox.list(ada.id).at(-1)!.prompt
    expect(prompt).toMatch(/^\[company\] /)
    expect(prompt).toContain(`AC-${ticket.id}`)
    expect(prompt).toContain(`web: ${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`)
    expect(prompt).toContain(`api: ${onDisk('/work/acme/worktrees/api/ticket-ac-')}${ticket.id}-login-page`)
    expect(prompt).toContain(`branch ticket-ac-${ticket.id}-login-page`)
  })

  it('does not wake the assignee who claimed the ticket, whose claim already names the directories', () => {
    const { engine, ada, boardAsAda, loginTicket } = setup()
    const ticket = loginTicket()
    const before = engine.inbox.list(ada.id).length

    boardAsAda().moveTicket(ticket.id, 'doing')

    expect(engine.inbox.list(ada.id)).toHaveLength(before)
    expect(engine.code.brief(ticket.id)).toContain(
      `${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`,
    )
  })

  it('creates each worktree once, and one for a repo added while the ticket is in progress', () => {
    const { engine, git, ada, web, api, board } = setup()
    const { id } = board().createTicket({ title: 'API', assigneeId: ada.id, repos: [web.id] })

    board().moveTicket(id, 'doing')
    board().moveTicket(id, 'doing', 0)
    board().updateTicket(id, { repos: [web.id, api.id] })

    expect(git.worktrees.map((w) => w.repoPath)).toEqual([onDisk('/code/web'), onDisk('/code/api')])
    expect(engine.code.of(id).worktrees.map((w) => w.repoId)).toEqual([web.id, api.id])
  })

  it('creates nothing for a ticket without an assignee or without repos, or outside doing', () => {
    const { engine, git, ada, web, board } = setup()
    const free = board().createTicket({ title: 'Free', repos: [web.id] })
    const noRepos = board().createTicket({ title: 'Docs', assigneeId: ada.id })
    const todo = board().createTicket({ title: 'Later', assigneeId: ada.id, repos: [web.id] })

    board().moveTicket(free.id, 'doing')
    board().moveTicket(noRepos.id, 'doing')
    board().updateTicket(todo.id, { title: 'Later still' })

    expect(git.worktrees).toEqual([])
    expect(engine.code.list()).toEqual([])
  })

  it('creates worktrees when a ticket in doing gets an assignee', () => {
    const { engine, ada, web, board } = setup()
    const ticket = board().createTicket({ title: 'Free', repos: [web.id], column: 'doing' })

    board().updateTicket(ticket.id, { assigneeId: ada.id })

    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('refuses the move and leaves the ticket where it was when a worktree cannot be created', () => {
    const { engine, git, board, loginTicket } = setup()
    const ticket = loginTicket()
    git.failWorktree(onDisk('/code/api'), `fatal: ${onDisk('/code/api')} is not a git repo`)

    expect(() => board().moveTicket(ticket.id, 'doing')).toThrow(/not a git repo/)

    expect(
      board()
        .snapshot()
        .tickets.find((t) => t.id === ticket.id)?.column,
    ).toBe('planning')
    expect(engine.code.of(ticket.id).worktrees.map((w) => w.repoId)).toHaveLength(1)
  })

  it('lists the tickets that have worktrees and tells listeners', () => {
    const { engine, board, loginTicket } = setup()
    const ticket = loginTicket()
    const changed = vi.fn()
    engine.code.onChange(changed)

    board().moveTicket(ticket.id, 'doing')

    expect(changed).toHaveBeenCalled()
    expect(engine.code.list()).toEqual([
      expect.objectContaining({ ticketId: ticket.id, worktrees: expect.any(Array), pullRequests: [] }),
    ])
  })
})

describe('PR per repo', () => {
  it('opens a PR per repo, linked to the ticket, when the boss moves it to Review', async () => {
    const { engine, git, ada, web, api, board, prs, loginTicket } = setup()
    const ticket = loginTicket()
    board().updateTicket(ticket.id, { description: 'Email and password.' })
    board().moveTicket(ticket.id, 'doing')

    board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    expect(engine.code.of(ticket.id).pullRequests).toEqual([
      expect.objectContaining({ repoId: web.id, url: expect.stringMatching(/\/pull\/\d+$/) }),
      expect.objectContaining({ repoId: api.id, url: expect.stringMatching(/\/pull\/\d+$/) }),
    ])
    expect(git.pullRequests).toEqual([
      expect.objectContaining({
        path: `${onDisk('/work/acme/worktrees/web/ticket-ac-')}${ticket.id}-login-page`,
        branch: `ticket-ac-${ticket.id}-login-page`,
        base: 'main',
        title: `AC-${ticket.id} Login page`,
        body: expect.stringContaining(`AC-${ticket.id}`),
      }),
      expect.objectContaining({ path: `${onDisk('/work/acme/worktrees/api/ticket-ac-')}${ticket.id}-login-page` }),
    ])
    expect(git.pullRequests[0]!.body).toContain('Email and password.')
    const [first, second] = engine.code.of(ticket.id).pullRequests
    expect(prs()).toEqual([
      expect.objectContaining({
        authorId: COMPANY_AUTHOR,
        text: expect.stringMatching(new RegExp(`PR opened.*AC-${ticket.id}.*web.*${escapeRegExp(first!.url)}`)),
      }),
      expect.objectContaining({
        authorId: COMPANY_AUTHOR,
        text: expect.stringMatching(new RegExp(`PR opened.*AC-${ticket.id}.*api.*${escapeRegExp(second!.url)}`)),
      }),
      expect.objectContaining({
        authorId: COMPANY_AUTHOR,
        text: expect.stringMatching(new RegExp(`Review requested from @boss for AC-${ticket.id}`)),
      }),
    ])
    expect(engine.inbox.list(ada.id).at(-1)).toMatchObject({ kind: 'ticket', channelId: 'prs' })
  })

  it('opens the PR into the ticket’s base, even when it moved after the worktree was cut (T286)', async () => {
    const { engine, git, board, loginTicket } = setup()
    const ticket = loginTicket()
    board().moveTicket(ticket.id, 'doing')
    expect(engine.code.of(ticket.id).worktrees.map((w) => w.base)).toEqual(['main', 'main'])

    board().updateTicket(ticket.id, { baseBranch: 'develop' })
    expect(engine.code.of(ticket.id).worktrees.map((w) => w.base)).toEqual(['develop', 'develop'])
    board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(git.pullRequests).toHaveLength(2))
    expect(git.pullRequests.map((pr) => pr.base)).toEqual(['develop', 'develop'])
  })

  it('says so in #prs when the base moves under a PR that is already open (T286)', async () => {
    const { engine, git, board, prs, loginTicket } = setup()
    const ticket = loginTicket()
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))

    board().updateTicket(ticket.id, { baseBranch: 'develop' })

    expect(git.pullRequests.map((pr) => pr.base)).toEqual(['main', 'main'])
    expect(prs().at(-1)?.text).toMatch(new RegExp(`AC-${ticket.id} now goes into develop.*retarget .* to develop`))
  })

  it('opens each PR once', async () => {
    const { engine, git, board, loginTicket } = setup()
    const ticket = loginTicket()
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    board().moveTicket(ticket.id, 'review', 0)
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))

    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(git.pullRequests).toHaveLength(2)
  })

  it('opens nothing for a ticket that never had worktrees', async () => {
    const { git, prs, board, loginTicket } = setup()
    const ticket = loginTicket()

    board().moveTicket(ticket.id, 'review')
    await Promise.resolve()

    expect(git.pullRequests).toEqual([])
    expect(prs()).toEqual([])
  })

  it('announces a PR that could not be opened, which wakes the assignee', async () => {
    const { engine, git, ada, board, prs, loginTicket } = setup()
    const ticket = loginTicket()
    board().moveTicket(ticket.id, 'doing')
    git.failPullRequest(onDisk('/work/acme/worktrees/api/'), 'No commits between main and the branch')

    board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(prs()).toHaveLength(2))
    expect(prs()[1]!.text).toMatch(new RegExp(`AC-${ticket.id}.*api.*No commits between main and the branch`))
    expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1)
    expect(engine.inbox.list(ada.id).at(-1)?.text).toContain('No commits between')
  })

  it('asks the boss before an Employee opens PRs under Managed, and opens them on approval', async () => {
    const { engine, git, ada, boardAsAda, loginTicket } = setup()
    const ticket = loginTicket()
    boardAsAda().moveTicket(ticket.id, 'doing')

    boardAsAda().moveTicket(ticket.id, 'review')
    boardAsAda().moveTicket(ticket.id, 'review', 0)
    await Promise.resolve()

    const pending = engine.approvals.list({ status: 'pending' })
    expect(pending).toEqual([
      expect.objectContaining({ action: 'open_pr', requesterId: ada.id, subject: `AC-${ticket.id} Login page` }),
    ])
    expect(git.pullRequests).toEqual([])

    engine.approvals.decide(pending[0]!.id, { approve: true })

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
  })

  it('opens no PR when the boss rejects the request', async () => {
    const { engine, git, boardAsAda, loginTicket } = setup()
    const ticket = loginTicket()
    boardAsAda().moveTicket(ticket.id, 'doing')
    boardAsAda().moveTicket(ticket.id, 'review')

    engine.approvals.decide(engine.approvals.list()[0]!.id, { approve: false, reason: 'Not yet' })
    await Promise.resolve()

    expect(git.pullRequests).toEqual([])
  })

  it('opens an Employee’s PRs without asking under Autonomous', async () => {
    const { engine, boardAsAda, loginTicket } = setup()
    engine.approvals.setLevel('autonomous')
    const ticket = loginTicket()
    boardAsAda().moveTicket(ticket.id, 'doing')

    boardAsAda().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    expect(engine.approvals.list()).toEqual([])
  })
})

describe('Without a git service', () => {
  it('moves tickets without touching repos', () => {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      isGitRepo: () => true,
    })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), stack: node })
    const ticket = engine.board().createTicket({ title: 'T', assigneeId: ada.id, repos: [web.id] })

    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')

    expect(engine.code.of(ticket.id)).toEqual({ ticketId: ticket.id, worktrees: [], pullRequests: [] })
  })
})

/**
 * A repo inside a WSL distro, with the Company folder on a drive of the PC as T252 requires.
 *
 * Windows only, and not because the assertions would differ elsewhere: `\\wsl.localhost\…` is a
 * path shape only Windows has, and `repos.add` refuses it on a Mac exactly as `node:path` does.
 * `worktreeRootOf` itself is pinned on every platform in `core/company-data-ignore.test.ts`; what
 * this adds is the round trip — the folder git is asked to add, what the `worktree` table then
 * says, and the folder git is asked to remove when the ticket is done (T255).
 */
describe.skipIf(process.platform !== 'win32')('A ticket worktree for a repo inside WSL', () => {
  const REPO = '\\\\wsl.localhost\\Arch\\home\\b\\app'
  const WORKTREES = '\\\\wsl.localhost\\Arch\\home\\b\\app-worktrees'

  function inDistro() {
    const provider = fakeProvider()
    const git = fakeGit()
    git.withoutRemote(REPO)
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
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const app = engine.repos.add({ path: REPO, name: 'app', stack: node })
    return { engine, git, ada, app }
  }

  it('is created beside the repo and removed from there when the ticket merges', async () => {
    const { engine, git, ada, app } = inDistro()
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [app.id] })
    const branch = `ticket-ac-${ticket.id}-login-page`
    const worktree = `${WORKTREES}\\${branch}`

    engine.board().moveTicket(ticket.id, 'doing')

    expect(git.worktrees).toEqual([expect.objectContaining({ repoPath: REPO, path: worktree, branch })])
    expect(engine.code.of(ticket.id).worktrees).toEqual([expect.objectContaining({ repoId: app.id, path: worktree })])
    expect(engine.code.brief(ticket.id)).toContain(worktree)

    engine.board().moveTicket(ticket.id, 'review')
    engine.approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id, reason: 'Ready.' })
    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })

    await vi.waitFor(() => expect(engine.code.of(ticket.id).worktrees).toEqual([]))
    // The worktree goes; the repo beside it and the folder holding it are never what git is asked for.
    expect(git.removed).toEqual([{ repoPath: REPO, path: worktree, branch }])
  })
})

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
