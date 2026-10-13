import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'

const engines: CompanyEngine[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const stack = readyStack()

/** A Company with the repos web, api and infra attached. */
function engineWithCompany() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  for (const name of ['web', 'api', 'infra']) {
    engine.repos.add({ path: `${onDisk('/code')}${sep}${name}`, name, stack })
  }
  return engine
}

function repoIds(engine: CompanyEngine) {
  const id = (name: string) => engine.repos.list().find((r) => r.name === name)!.id
  return { web: id('web'), api: id('api'), infra: id('infra') }
}

function columnsOf(engine: CompanyEngine) {
  const { columns, tickets } = engine.board().snapshot()
  return Object.fromEntries(columns.map((c) => [c.id, tickets.filter((t) => t.column === c.id).map((t) => t.title)]))
}

describe('Board hierarchy', () => {
  it('starts empty with the six kanban columns in order, Planning first and Testing before Done', () => {
    const engine = engineWithCompany()

    const board = engine.board().snapshot()

    expect(board.columns.map((c) => c.title)).toEqual(['Planning', 'Ready', 'Doing', 'Review', 'Testing', 'Done'])
    expect(board).toMatchObject({ targets: [], epics: [], tickets: [] })
  })

  it('refuses board access when no Company is open', () => {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
    })
    engines.push(engine)

    expect(() => engine.board()).toThrow(/no company/i)
  })

  it('builds Target → Epic → Ticket → Subtask', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    const target = board.createTarget({ title: 'Magic-link login' })
    const epic = board.createEpic({ title: 'Login flow', targetId: target.id })
    const ticket = board.createTicket({ title: 'Send the email', epicId: epic.id })
    const subtask = board.createSubtask({ ticketId: ticket.id, title: 'Pick a template' })

    const snapshot = board.snapshot()
    expect(snapshot.targets).toEqual([{ id: target.id, title: 'Magic-link login', description: '', dueAt: null }])
    expect(snapshot.epics).toEqual([
      { id: epic.id, targetId: target.id, title: 'Login flow', description: '', color: 'indigo' },
    ])
    expect(snapshot.tickets).toEqual([
      {
        id: ticket.id,
        epicId: epic.id,
        title: 'Send the email',
        description: '',
        column: 'planning',
        assigneeId: null,
        repos: [],
        blocked: false,
        blockedReason: '',
        blockedBy: [],
        blocks: [],
        subtasks: [
          {
            id: subtask.id,
            ticketId: ticket.id,
            title: 'Pick a template',
            done: false,
            repo: null,
          },
        ],
        priority: 'normal',
        labels: [],
        baseBranch: null,
      },
    ])
  })

  it('keeps the day a target is due, and refuses one that is not a date (T151)', () => {
    const board = engineWithCompany().board()

    const target = board.createTarget({ title: 'Billing dashboard', dueAt: '2026-09-18' })
    expect(target.dueAt).toBe('2026-09-18')
    expect(board.updateTarget(target.id, { title: 'Billing' }).dueAt).toBe('2026-09-18')
    expect(board.updateTarget(target.id, { dueAt: null }).dueAt).toBeNull()
    expect(() => board.createTarget({ title: 'Later', dueAt: 'Friday' })).toThrow(/due day/)
    expect(() => board.createTarget({ title: 'Later', dueAt: '2026-02-30' })).toThrow(/due day/)
  })

  it('lets a discovery enter as a ticket with no epic, and a feature as an epic with no target', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    const epic = board.createEpic({ title: 'Dark mode' })
    const ticket = board.createTicket({ title: 'Flaky test in CI' })

    expect(epic.targetId).toBeNull()
    expect(ticket.epicId).toBeNull()
    expect(board.snapshot().tickets.map((t) => t.title)).toEqual(['Flaky test in CI'])
  })

  it('numbers tickets so chat can reference them as #1, #2', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    const first = board.createTicket({ title: 'One' })
    const second = board.createTicket({ title: 'Two' })

    expect([first.id, second.id]).toEqual([1, 2])
  })

  it('refuses parents that do not exist', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    expect(() => board.createEpic({ title: 'E', targetId: 99 })).toThrow(/target/i)
    expect(() => board.createTicket({ title: 'T', epicId: 99 })).toThrow(/epic/i)
    expect(() => board.createSubtask({ ticketId: 99, title: 'S' })).toThrow(/ticket/i)
    expect(board.snapshot()).toMatchObject({ epics: [], tickets: [] })
  })

  it('refuses blank titles', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = board.createTicket({ title: 'T' })

    expect(() => board.createTarget({ title: '  ' })).toThrow(/title/i)
    expect(() => board.createEpic({ title: '' })).toThrow(/title/i)
    expect(() => board.createTicket({ title: ' ' })).toThrow(/title/i)
    expect(() => board.createSubtask({ ticketId: ticket.id, title: '' })).toThrow(/title/i)
    expect(() => board.updateTicket(ticket.id, { title: '' })).toThrow(/title/i)
    expect(board.snapshot().tickets.map((t) => t.title)).toEqual(['T'])
  })

  it('edits targets, epics and tickets', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const target = board.createTarget({ title: 'Old target' })
    const epic = board.createEpic({ title: 'Old epic' })
    const ticket = board.createTicket({ title: 'Old ticket' })
    const { web, api } = repoIds(engine)

    board.updateTarget(target.id, { title: 'New target', description: 'why' })
    board.updateEpic(epic.id, { title: 'New epic', targetId: target.id })
    board.updateTicket(ticket.id, {
      title: 'New ticket',
      description: 'details',
      epicId: epic.id,
      assigneeId: 'ada',
      repos: [web, api],
    })

    const snapshot = board.snapshot()
    expect(snapshot.targets[0]).toMatchObject({ title: 'New target', description: 'why' })
    expect(snapshot.epics[0]).toMatchObject({ title: 'New epic', targetId: target.id })
    expect(snapshot.tickets[0]).toMatchObject({
      title: 'New ticket',
      description: 'details',
      epicId: epic.id,
      assigneeId: 'ada',
      repos: [web, api],
    })
  })

  it('refuses a ticket in a repo the Company does not have', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = board.createTicket({ title: 'T' })

    expect(() => board.createTicket({ title: 'U', repos: ['nope'] })).toThrow(/repo/i)
    expect(() => board.updateTicket(ticket.id, { repos: ['nope'] })).toThrow(/repo/i)
    expect(board.snapshot().tickets.map((t) => [t.title, t.repos])).toEqual([['T', []]])
  })

  it('refuses edits to things that do not exist', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    expect(() => board.updateTarget(1, { title: 'x' })).toThrow(/target/i)
    expect(() => board.updateEpic(1, { title: 'x' })).toThrow(/epic/i)
    expect(() => board.updateTicket(1, { title: 'x' })).toThrow(/ticket/i)
    expect(() => board.moveTicket(1, 'doing')).toThrow(/ticket/i)
    expect(() => board.updateSubtask(1, { done: true })).toThrow(/subtask/i)
  })

  it('keeps each Company its own board', () => {
    const engine = engineWithCompany()
    const acme = engine.currentCompany()!
    engine.board().createTicket({ title: 'Acme ticket' })

    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    expect(engine.board().snapshot().tickets).toEqual([])

    engine.switchCompany(acme.id)
    expect(
      engine
        .board()
        .snapshot()
        .tickets.map((t) => t.title),
    ).toEqual(['Acme ticket'])
  })

  it('finds the board again after the app restarts', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-'))
    tempDirs.push(folder)
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder, name: 'Acme' })
    first.board().createTicket({ title: 'Survives' })
    first.board().setWipLimit('doing', 2)
    first.close()

    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)
    second.openCompany(folder)

    expect(
      second
        .board()
        .snapshot()
        .tickets.map((t) => t.title),
    ).toEqual(['Survives'])
    expect(second.board().snapshot().columns[2]).toMatchObject({ id: 'doing', wipLimit: 2 })
  })
})

describe('Board columns', () => {
  it('puts new tickets at the bottom of Planning unless told otherwise (T171)', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    board.createTicket({ title: 'A' })
    board.createTicket({ title: 'B' })
    board.createTicket({ title: 'C', column: 'review' })

    expect(columnsOf(engine)).toEqual({
      planning: ['A', 'B'],
      todo: [],
      doing: [],
      review: ['C'],
      testing: [],
      done: [],
    })
  })

  it('moves a ticket between columns, to the bottom by default', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const a = board.createTicket({ title: 'A' })
    board.createTicket({ title: 'B', column: 'doing' })

    const moved = board.moveTicket(a.id, 'doing')

    expect(moved.column).toBe('doing')
    expect(columnsOf(engine)).toEqual({ planning: [], todo: [], doing: ['B', 'A'], review: [], testing: [], done: [] })
  })

  it('moves a ticket to a given place in a column', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    board.createTicket({ title: 'A', column: 'doing' })
    board.createTicket({ title: 'B', column: 'doing' })
    const c = board.createTicket({ title: 'C' })

    board.moveTicket(c.id, 'doing', 1)
    expect(columnsOf(engine)['doing']).toEqual(['A', 'C', 'B'])

    board.moveTicket(c.id, 'doing', 0)
    expect(columnsOf(engine)['doing']).toEqual(['C', 'A', 'B'])

    board.moveTicket(c.id, 'doing', 99)
    expect(columnsOf(engine)['doing']).toEqual(['A', 'B', 'C'])
  })

  it('reorders within a column', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const a = board.createTicket({ title: 'A', column: 'todo' })
    board.createTicket({ title: 'B', column: 'todo' })
    board.createTicket({ title: 'C', column: 'todo' })

    board.moveTicket(a.id, 'todo', 2)

    expect(columnsOf(engine)['todo']).toEqual(['B', 'C', 'A'])
  })

  it('refuses a column that does not exist', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const a = board.createTicket({ title: 'A' })

    expect(() => board.moveTicket(a.id, 'backlog' as never)).toThrow(/column/i)
    expect(() => board.createTicket({ title: 'B', column: 'later' as never })).toThrow(/column/i)
    expect(columnsOf(engine)['planning']).toEqual(['A'])
  })

  it('flags a ticket blocked with a reason and clears it', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const a = board.createTicket({ title: 'A', column: 'doing' })

    board.updateTicket(a.id, { blocked: true, blockedReason: 'waiting on API keys' })
    expect(board.snapshot().tickets[0]).toMatchObject({
      column: 'doing',
      blocked: true,
      blockedReason: 'waiting on API keys',
    })

    board.updateTicket(a.id, { blocked: false })
    expect(board.snapshot().tickets[0]).toMatchObject({ blocked: false, blockedReason: '' })
  })
})

describe('Repos without checks', () => {
  it('can be worked: tickets move into Doing and are created there', () => {
    const engine = engineWithCompany()
    const { web, api } = repoIds(engine)
    engine.repos.update(web, { stack: { install: '', build: '', test: '', lint: '', packageManager: '' } })
    const board = engine.board()
    const ticket = board.createTicket({ title: 'Login', repos: [api, web] })

    board.moveTicket(ticket.id, 'doing')
    board.createTicket({ title: 'Logout', column: 'doing', repos: [web] })

    expect(columnsOf(engine)).toMatchObject({ planning: [], doing: ['Login', 'Logout'] })
  })
})

describe('WIP limits', () => {
  it('has no limits until the boss sets one', () => {
    const engine = engineWithCompany()

    expect(
      engine
        .board()
        .snapshot()
        .columns.map((c) => c.wipLimit),
    ).toEqual([null, null, null, null, null, null])
  })

  it('counts tickets per column and shows a breach once a column is over its limit', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    board.setWipLimit('doing', 1)
    const a = board.createTicket({ title: 'A' })
    const b = board.createTicket({ title: 'B' })

    board.moveTicket(a.id, 'doing')
    expect(board.snapshot().columns[2]).toEqual({
      id: 'doing',
      title: 'Doing',
      wipLimit: 1,
      count: 1,
      overLimit: false,
    })

    board.moveTicket(b.id, 'doing')
    expect(board.snapshot().columns[2]).toMatchObject({ count: 2, overLimit: true })
    expect(columnsOf(engine)['doing']).toEqual(['A', 'B'])
  })

  it('clears a breach when a ticket leaves or the limit is lifted', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    board.setWipLimit('review', 1)
    const a = board.createTicket({ title: 'A', column: 'review' })
    board.createTicket({ title: 'B', column: 'review' })
    expect(board.snapshot().columns[3]!.overLimit).toBe(true)

    board.moveTicket(a.id, 'done')
    expect(board.snapshot().columns[3]!.overLimit).toBe(false)

    board.createTicket({ title: 'C', column: 'review' })
    board.setWipLimit('review', null)
    expect(board.snapshot().columns[3]).toMatchObject({
      wipLimit: null,
      count: 2,
      overLimit: false,
    })
  })

  it('refuses a limit that is not a positive whole number', () => {
    const engine = engineWithCompany()
    const board = engine.board()

    expect(() => board.setWipLimit('doing', 0)).toThrow(/limit/i)
    expect(() => board.setWipLimit('doing', 1.5)).toThrow(/limit/i)
    expect(() => board.setWipLimit('nope' as never, 2)).toThrow(/column/i)
    expect(board.snapshot().columns[2]!.wipLimit).toBeNull()
  })
})

describe('Subtask rule', () => {
  function ticketFor(engine: CompanyEngine) {
    const { web, api } = repoIds(engine)
    return engine.board().createTicket({ title: 'Login', assigneeId: 'ada', repos: [web, api] })
  }

  it('lets a subtask name the ticket assignee and one of its repos', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)
    const { web } = repoIds(engine)

    const subtask = board.createSubtask({
      ticketId: ticket.id,
      title: 'Form',
      assigneeId: 'ada',
      repo: web,
    })

    expect(subtask).toMatchObject({ repo: web, done: false })
  })

  it('refuses a subtask for another person: that is a ticket', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)

    expect(() => board.createSubtask({ ticketId: ticket.id, title: 'Review', assigneeId: 'grace' })).toThrow(
      /assignee.*ticket/i,
    )
    expect(board.snapshot().tickets[0]!.subtasks).toEqual([])
  })

  it('refuses an assignee on a subtask of an unassigned ticket', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = board.createTicket({ title: 'Unowned' })

    expect(() => board.createSubtask({ ticketId: ticket.id, title: 'x', assigneeId: 'ada' })).toThrow(/assignee/i)
  })

  it('refuses a subtask in another repo: that is a ticket', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)
    const { infra } = repoIds(engine)

    expect(() => board.createSubtask({ ticketId: ticket.id, title: 'Deploy', repo: infra })).toThrow(/repo.*ticket/i)
    expect(board.snapshot().tickets[0]!.subtasks).toEqual([])
  })

  it('applies the same rule when a subtask is edited', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)
    const { web, api, infra } = repoIds(engine)
    const subtask = board.createSubtask({ ticketId: ticket.id, title: 'Form', repo: web })

    expect(() => board.updateSubtask(subtask.id, { assigneeId: 'grace' })).toThrow(/assignee/i)
    expect(() => board.updateSubtask(subtask.id, { repo: infra })).toThrow(/repo/i)
    board.updateSubtask(subtask.id, { repo: api, assigneeId: 'ada' })

    expect(board.snapshot().tickets[0]!.subtasks[0]).toMatchObject({ repo: api })
  })

  it('refuses to drop a repo from a ticket while a subtask still uses it', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)
    const { web, api } = repoIds(engine)
    board.createSubtask({ ticketId: ticket.id, title: 'Form', repo: web })

    expect(() => board.updateTicket(ticket.id, { repos: [api] })).toThrow(/repo.*subtask/i)
    expect(board.snapshot().tickets[0]!.repos).toEqual([web, api])

    board.updateTicket(ticket.id, { repos: [web] })
    expect(board.snapshot().tickets[0]!.repos).toEqual([web])
  })

  it('ticks, renames and removes subtasks in order', () => {
    const engine = engineWithCompany()
    const board = engine.board()
    const ticket = ticketFor(engine)
    const one = board.createSubtask({ ticketId: ticket.id, title: 'One' })
    const two = board.createSubtask({ ticketId: ticket.id, title: 'Two' })
    board.createSubtask({ ticketId: ticket.id, title: 'Three' })

    board.updateSubtask(one.id, { done: true })
    board.updateSubtask(two.id, { title: 'Second' })
    board.deleteSubtask(one.id)

    expect(board.snapshot().tickets[0]!.subtasks.map((s) => [s.title, s.done])).toEqual([
      ['Second', false],
      ['Three', false],
    ])
    expect(() => board.deleteSubtask(one.id)).toThrow(/subtask/i)
  })
})

describe('Board changes', () => {
  it('tells subscribers after every edit', () => {
    const engine = engineWithCompany()
    let changes = 0
    engine.onBoardChange(() => changes++)
    const board = engine.board()

    const ticket = board.createTicket({ title: 'A' })
    board.moveTicket(ticket.id, 'doing')
    board.createSubtask({ ticketId: ticket.id, title: 's' })
    board.setWipLimit('doing', 3)

    // Five, not four: a new ticket also opens its plan, which the board draws as a Planning chip.
    expect(changes).toBe(5)
  })

  it('stays quiet when an edit is refused', () => {
    const engine = engineWithCompany()
    let changes = 0
    engine.onBoardChange(() => changes++)

    expect(() => engine.board().createTicket({ title: '' })).toThrow()

    expect(changes).toBe(0)
  })
})
