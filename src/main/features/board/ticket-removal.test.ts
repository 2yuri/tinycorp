import { afterEach, describe, expect, it, vi } from 'vitest'
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
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
  const board = () => engine.board()
  const removals = () => engine.ticketRemovals()
  const has = (id: number) =>
    board()
      .snapshot()
      .tickets.some((ticket) => ticket.id === id)

  /** A ticket Ada holds in Doing: a worktree in web, two subtasks, and a ticket waiting on it. */
  function started() {
    const ticket = board().createTicket({ title: 'Retry a failed charge', assigneeId: ada.id, repos: [web.id] })
    board().createSubtask({ ticketId: ticket.id, title: 'Retry once' })
    board().createSubtask({ ticketId: ticket.id, title: 'Say why it failed' })
    const waiting = board().createTicket({ title: 'Refund a charge' })
    board().addBlocker(waiting.id, ticket.id)
    board().moveTicket(ticket.id, 'doing')
    return { ticket, waiting, path: engine.code.of(ticket.id).worktrees[0]!.path }
  }

  return { engine, git, ada, board, removals, has, started }
}

describe('What deleting a ticket takes with it (T275)', () => {
  it('names the ticket, its subtasks, its links, its worktree and who holds it', async () => {
    const { removals, started } = setup()
    const { ticket } = started()

    await expect(removals().ticketRemoval(ticket.id)).resolves.toEqual({
      ticketId: ticket.id,
      code: `AC-${ticket.id}`,
      title: 'Retry a failed charge',
      subtasks: 2,
      links: 1,
      worktrees: ['web'],
      holder: 'Ada',
    })
  })

  it('deletes it with its subtasks, links and worktree, and tells whoever held it to drop it', async () => {
    const { engine, git, ada, board, removals, has, started } = setup()
    const { ticket, waiting, path } = started()

    await expect(removals().deleteTicket(ticket.id)).resolves.toMatchObject({ code: `AC-${ticket.id}` })

    expect(has(ticket.id)).toBe(false)
    expect(
      board()
        .snapshot()
        .tickets.find((t) => t.id === waiting.id)?.blockedBy,
    ).toEqual([])
    expect(git.removed).toEqual([expect.objectContaining({ repoPath: onDisk('/code/web'), path })])
    expect(engine.code.of(ticket.id).worktrees).toEqual([])
    expect(engine.inbox.list(ada.id).at(-1)).toMatchObject({
      kind: 'deleted',
      ticketId: null,
      text: 'Retry a failed charge',
      prompt: expect.stringContaining(`The boss deleted AC-${ticket.id}`),
    })
    // The wake that gave Ada the ticket stays in her history, pointing nowhere.
    expect(engine.inbox.list(ada.id).some((item) => item.ticketId === ticket.id)).toBe(false)
    expect(engine.activity.list({ groups: ['tickets'] })[0]).toMatchObject({
      kind: 'ticket_deleted',
      summary: `deleted AC-${ticket.id}`,
    })
  })

  it('deletes a ticket nobody started, which has no worktree and nobody to tell', async () => {
    const { git, board, removals, has } = setup()
    const { id } = board().createTicket({ title: 'Duplicate of the retry' })

    await expect(removals().deleteTicket(id)).resolves.toEqual(
      expect.objectContaining({ subtasks: 0, links: 0, worktrees: [], holder: null }),
    )
    expect(has(id)).toBe(false)
    expect(git.removed).toEqual([])
  })

  it('turns down an Approval still waiting on the ticket, and says why', async () => {
    const { engine, ada, removals, started } = setup()
    const { ticket } = started()
    engine.approvals.request({ requesterId: ada.id, action: 'merge', ticketId: ticket.id, reason: 'Ready.' })

    await removals().deleteTicket(ticket.id)

    expect(engine.approvals.list()).toEqual([
      expect.objectContaining({ status: 'rejected', decisionReason: `AC-${ticket.id} was deleted.` }),
    ])
  })
})

describe('What stays (T275)', () => {
  it('keeps a ticket that opened a pull request, with its history', async () => {
    const { engine, board, removals, has, started } = setup()
    const { ticket } = started()
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))

    const why = `AC-${ticket.id} opened a pull request, so it stays on the board with its history.`
    await expect(removals().ticketRemoval(ticket.id)).rejects.toThrow(why)
    await expect(removals().deleteTicket(ticket.id)).rejects.toThrow(why)
    expect(has(ticket.id)).toBe(true)
  })

  it('keeps a ticket whose branch has commits nobody merged, or changes nobody committed', async () => {
    const { git, removals, has, started } = setup()
    const { ticket, path } = started()

    git.setBranchWork(path, { commits: 2 })
    await expect(removals().deleteTicket(ticket.id)).rejects.toThrow(
      `AC-${ticket.id}’s branch in web has 2 commits nobody merged, and deleting it would throw them away.`,
    )
    git.setBranchWork(path, { commits: 0, uncommitted: true })
    await expect(removals().ticketRemoval(ticket.id)).rejects.toThrow(
      `AC-${ticket.id}’s worktree in web has changes nobody committed, and deleting it would throw them away.`,
    )

    expect(git.removed).toEqual([])
    expect(has(ticket.id)).toBe(true)
  })

  it('says so for a ticket that is not there', async () => {
    await expect(setup().removals().ticketRemoval(999)).rejects.toThrow('There is no ticket 999')
  })
})
