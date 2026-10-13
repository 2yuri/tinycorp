import { sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_AUTHOR } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { APP_MERGES } from '../approvals'
import { NOT_AN_APPROVAL } from './merge-gate'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** Acme with `notes` (no remote) and `api` (with origin), and Ada holding a ticket in `notes` in Review. */
function setup() {
  const provider = fakeProvider()
  const git = fakeGit()
  git.withoutRemote(onDisk('/code/notes'))
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
  const notes = engine.repos.add({ path: onDisk('/code/notes'), name: 'notes', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
  const infra = engine.repos.add({ path: onDisk('/code/infra'), name: 'infra', stack: readyStack() })
  const board = () => engine.board()
  const column = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)?.column
  const prs = () => engine.chat().read({ channelId: 'prs' })

  function ada$() {
    if (engine.sessions.get(ada.id).status === 'off') engine.sessions.start(ada.id)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(ada.id).mcp!.token)
    if (!caller) throw new Error('Ada has no MCP caller')
    return caller
  }

  /** A ticket of Ada's in `repos`, moved to Review by the boss. */
  function inReview(...repos: string[]) {
    const ticket = board().createTicket({
      title: 'Login page',
      assigneeId: ada.id,
      repos: repos.length ? repos : [notes.id],
    })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    return ticket
  }

  const askToMerge = (ticketId: number) =>
    engine.approvals.request({ requesterId: ada.id, action: 'merge', ticketId, reason: 'Ready.' })

  return { engine, git, ada, notes, api, infra, board, column, prs, ada$, inReview, askToMerge }
}

describe('The merge gate for a repo without a remote', () => {
  it('refuses to merge without an approved merge approval, and says a chat message is not one', async () => {
    const { engine, git, ada$, inReview, column } = setup()
    const ticket = inReview()
    engine.chat().post({ authorId: 'boss', channelId: 'general', text: 'i approve' })

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(
      `Merging AC-${ticket.id} needs an approved merge approval, and there is none. ${NOT_AN_APPROVAL}`,
    )
    expect(git.localMerges).toEqual([])
    expect(column(ticket.id)).toBe('review')
    expect(engine.code.of(ticket.id).worktrees).toHaveLength(1)
  })

  it('refuses while the merge approval is still pending', async () => {
    const { git, ada$, inReview, askToMerge } = setup()
    const ticket = inReview()
    askToMerge(ticket.id)

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(/waiting for the boss/)
    expect(git.localMerges).toEqual([])
  })

  it('does not count an approval for another ticket', async () => {
    const { engine, git, ada$, inReview, askToMerge } = setup()
    const other = inReview()
    const ticket = inReview()
    askToMerge(other.id)
    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })
    await vi.waitFor(() => expect(git.localMerges).toHaveLength(1))

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(/needs an approved merge approval/)
    expect(git.localMerges.map((m) => m.branch)).toEqual([`ticket-ac-${other.id}-login-page`])
  })

  it('merges locally in the app once the boss approves, removes the worktree and moves the ticket to Done', async () => {
    const { engine, git, ada, inReview, askToMerge, column, prs } = setup()
    const ticket = inReview()
    const outcome = askToMerge(ticket.id)
    expect(outcome.gate).toBe('ask')

    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })

    await vi.waitFor(() => expect(column(ticket.id)).toBe('done'))
    const branch = `ticket-ac-${ticket.id}-login-page`
    expect(git.localMerges).toEqual([{ repoPath: onDisk('/code/notes'), branch, base: 'main' }])
    expect(git.removed).toEqual([
      { repoPath: onDisk('/code/notes'), path: `${onDisk('/work/acme/worktrees/notes')}${sep}${branch}`, branch },
    ])
    expect(engine.code.of(ticket.id).worktrees).toEqual([])
    expect(prs().at(-1)).toMatchObject({
      authorId: COMPANY_AUTHOR,
      text: `Merged AC-${ticket.id} Login page into main in notes, locally. Worktrees removed; AC-${ticket.id} is done.`,
    })
    expect(engine.inbox.list(ada.id).find((i) => i.kind === 'approval')?.prompt).toContain(APP_MERGES)
  })

  it('merges when asked through the tool after an approval, e.g. to retry a failed merge', async () => {
    const { engine, git, ada$, inReview, askToMerge, column, prs } = setup()
    const ticket = inReview()
    const branch = `ticket-ac-${ticket.id}-login-page`
    git.failLocalMerge(branch, 'Could not merge: the branches conflict')
    askToMerge(ticket.id)
    engine.approvals.decide(engine.approvals.list({ status: 'pending' })[0]!.id, { approve: true })
    await vi.waitFor(() => expect(prs().at(-1)?.text).toContain('the branches conflict'))
    expect(column(ticket.id)).toBe('review')

    const merged = await ada$().merges.merge(ticket.id)

    expect(merged).toMatchObject({ ticketId: ticket.id, repos: ['notes'] })
    expect(git.localMerges).toHaveLength(2)
    expect(column(ticket.id)).toBe('done')
  })

  it('needs no approval when the autonomy level lets merges through', async () => {
    const { engine, git, ada$, inReview, column } = setup()
    engine.approvals.setLevel('autonomous')
    const ticket = inReview()

    await ada$().merges.merge(ticket.id)

    expect(git.localMerges).toHaveLength(1)
    expect(column(ticket.id)).toBe('done')
  })

  it('refuses a ticket that is not in Review', async () => {
    const { engine, git, ada$, board, ada, notes } = setup()
    engine.approvals.setLevel('autonomous')
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [notes.id] })
    board().moveTicket(ticket.id, 'doing')

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(`AC-${ticket.id} is not in review`)
    expect(git.localMerges).toEqual([])
  })

  it('leaves a ticket with PRs to the review flow', async () => {
    const { engine, git, ada$, inReview, api } = setup()
    engine.approvals.setLevel('autonomous')
    const ticket = inReview(api.id)

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(/merges through review/)
    expect(git.localMerges).toEqual([])
  })

  /**
   * A repo with an `origin` TinyCorp cannot open a PR on is neither of the two cases the gate knew:
   * no PR is coming, and TinyCorp still does not merge into a branch it cannot open one against —
   * that repo belongs to somebody whose rules it does not know. So it says which forge, and where
   * the work is, rather than pointing at a review that can never happen.
   */
  it('refuses a local merge in a repo on a forge it has no adapter for, and says where the work is', async () => {
    const { engine, git, ada$, inReview, infra } = setup()
    engine.approvals.setLevel('autonomous')
    const ticket = inReview(infra.id)

    await expect(ada$().merges.merge(ticket.id)).rejects.toThrow(
      /No adapter for gitlab.example.com, cannot open a PR, and TinyCorp does not merge into a branch it cannot open one against/,
    )
    expect(git.localMerges).toEqual([])
  })
})

describe('Done', () => {
  it('is not a column an Employee can move a ticket with a branch to', () => {
    const { ada$, inReview, column } = setup()
    const ticket = inReview()

    expect(() => ada$().board.moveTicket(ticket.id, 'done')).toThrow(/the app moves it to Done when it merges/)
    expect(column(ticket.id)).toBe('review')
  })

  it('is still reachable by an Employee for a ticket with no branch', () => {
    const { ada$, board, ada, column } = setup()
    const ticket = board().createTicket({ title: 'Write the plan', assigneeId: ada.id })

    ada$().board.moveTicket(ticket.id, 'done')

    expect(column(ticket.id)).toBe('done')
  })
})
