import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { migrate } from '../../core/engine/migrations'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { BOARD_MIGRATION } from './board'
import { TICKET_EXTRAS_MIGRATION } from './ticket-extras'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const stack = readyStack()

function engineWithCompany(git = fakeGit()) {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: fakeProvider() },
    isGitRepo: () => true,
    git,
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack })
  return { engine, git, web, api }
}

describe('Ticket priority, labels and base branch', () => {
  it('defaults a new ticket to normal priority, no labels and the repos’ default branch', () => {
    const { engine } = engineWithCompany()

    const ticket = engine.board().createTicket({ title: 'Fix checkout' })

    expect(ticket).toMatchObject({ priority: 'normal', labels: [], baseBranch: null })
  })

  it('creates a ticket with a priority, labels and a base branch, and shows them on the board', () => {
    const { engine } = engineWithCompany()

    const created = engine.board().createTicket({
      title: 'Fix checkout',
      priority: 'high',
      labels: [' bug', 'checkout', 'Bug', '', 'p1'],
      baseBranch: ' release/2.0 ',
    })

    const listed = engine
      .board()
      .snapshot()
      .tickets.find((t) => t.id === created.id)
    expect(listed).toMatchObject({
      priority: 'high',
      labels: ['bug', 'checkout', 'p1'],
      baseBranch: 'release/2.0',
    })
  })

  it('changes them on update and keeps them when omitted', () => {
    const { engine } = engineWithCompany()
    const board = engine.board()
    const { id } = board.createTicket({
      title: 'Fix checkout',
      priority: 'low',
      labels: ['bug'],
      baseBranch: 'develop',
    })

    board.updateTicket(id, { title: 'Fix the checkout' })
    expect(board.snapshot().tickets[0]).toMatchObject({ priority: 'low', labels: ['bug'], baseBranch: 'develop' })

    const updated = board.updateTicket(id, { priority: 'urgent', labels: ['p0'], baseBranch: null })
    expect(updated).toMatchObject({ priority: 'urgent', labels: ['p0'], baseBranch: null })

    expect(board.updateTicket(id, { baseBranch: '  ' }).baseBranch).toBeNull()
  })

  it('refuses an unknown priority, labels that are not a list of text, and a bad branch name', () => {
    const { engine } = engineWithCompany()
    const board = engine.board()
    const { id } = board.createTicket({ title: 'Fix checkout' })

    expect(() => board.createTicket({ title: 'x', priority: 'asap' as never })).toThrow(
      'A priority is one of low, normal, high, urgent',
    )
    expect(() => board.updateTicket(id, { labels: 'bug' as never })).toThrow('Labels must be a list of text')
    expect(() => board.updateTicket(id, { labels: ['x'.repeat(33)] })).toThrow('at most 32 characters')
    expect(() => board.updateTicket(id, { labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).toThrow(
      'at most 20 labels',
    )
    expect(() => board.updateTicket(id, { baseBranch: 'no spaces here' })).toThrow('not a valid branch name')
    expect(() => board.updateTicket(id, { baseBranch: '--force' })).toThrow('not a valid branch name')
    expect(board.snapshot().tickets).toHaveLength(1)
    expect(board.snapshot().tickets[0]).toMatchObject({ priority: 'normal', labels: [], baseBranch: null })
  })

  it('starts worktrees from the ticket’s base branch and opens PRs into it', async () => {
    const { engine, git, web, api } = engineWithCompany()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const board = engine.board()
    const { id } = board.createTicket({
      title: 'Fix checkout',
      repos: [web.id, api.id],
      assigneeId: ada.id,
      baseBranch: 'release/2.0',
    })

    board.moveTicket(id, 'doing')

    expect(git.worktrees.map((w) => w.base)).toEqual(['release/2.0', 'release/2.0'])
    expect(engine.code.of(id).worktrees.map((w) => w.base)).toEqual(['release/2.0', 'release/2.0'])

    board.moveTicket(id, 'review')
    await expect.poll(() => git.pullRequests.length).toBe(2)
    expect(git.pullRequests.map((p) => p.base)).toEqual(['release/2.0', 'release/2.0'])
  })

  it('leaves the base to each repo’s default branch when the ticket names none', () => {
    const { engine, git, web } = engineWithCompany(fakeGit({ base: 'trunk' }))
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const board = engine.board()
    const { id } = board.createTicket({ title: 'Fix checkout', repos: [web.id], assigneeId: ada.id })

    board.moveTicket(id, 'doing')

    expect(git.worktrees[0]).not.toHaveProperty('base')
    expect(engine.code.of(id).worktrees[0]?.base).toBe('trunk')
  })
})

describe('Epic colour', () => {
  it('gives new epics the palette in turn and keeps a chosen colour', () => {
    const { engine } = engineWithCompany()
    const board = engine.board()

    const first = board.createEpic({ title: 'Billing' })
    const second = board.createEpic({ title: 'Onboarding' })
    const chosen = board.createEpic({ title: 'Infra', color: 'red' })

    expect([first.color, second.color, chosen.color]).toEqual(['indigo', 'violet', 'red'])
    expect(board.snapshot().epics.map((e) => e.color)).toEqual(['indigo', 'violet', 'red'])
  })

  it('changes an epic’s colour and refuses one outside the palette', () => {
    const { engine } = engineWithCompany()
    const board = engine.board()
    const epic = board.createEpic({ title: 'Billing' })

    expect(board.updateEpic(epic.id, { color: 'green' }).color).toBe('green')
    expect(board.updateEpic(epic.id, { title: 'Billing v2' }).color).toBe('green')
    expect(() => board.updateEpic(epic.id, { color: 'pink' as never })).toThrow(
      'An epic colour is one of indigo, violet, green, amber, red, blue',
    )
  })
})

describe('Ticket extras migration', () => {
  it('fills existing rows: normal priority, no labels, default base, epic colours in turn', () => {
    const db = new DatabaseSync(':memory:')
    runMigrations(db, [{ name: 'repos', sql: 'CREATE TABLE repo (id TEXT PRIMARY KEY)' }, BOARD_MIGRATION])
    db.exec(`INSERT INTO epic (title) VALUES ('a'), ('b'), ('c')`)
    db.exec(`INSERT INTO ticket (title, column_id, position) VALUES ('t', 'todo', 0)`)

    runMigrations(db, [TICKET_EXTRAS_MIGRATION])

    expect(db.prepare('SELECT color FROM epic ORDER BY id').all()).toEqual([
      { color: 'indigo' },
      { color: 'violet' },
      { color: 'green' },
    ])
    expect(db.prepare('SELECT priority, labels, base_branch FROM ticket').get()).toEqual({
      priority: 'normal',
      labels: '[]',
      base_branch: null,
    })
  })

  it('is part of the engine’s named migrations', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const names = (db.prepare('SELECT name FROM schema_migration').all() as { name: string }[]).map((r) => r.name)
    expect(names).toContain('board-ticket-priority-labels-base-branch-epic-color')
  })
})
