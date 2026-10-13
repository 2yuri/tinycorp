import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** Acme, keyed `AC`, with Ada to hold tickets. Tickets start Ready, so no planner is woken. */
function setup() {
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: fakeProvider() },
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const board = () => engine.board()
  const ticket = (title: string, assigneeId: string | null = null) =>
    board().createTicket({ title, column: 'todo', assigneeId })
  const get = (id: number) =>
    board()
      .snapshot()
      .tickets.find((t) => t.id === id)!
  const unblocked = () => engine.inbox.list(ada.id).filter((item) => item.kind === 'unblocked')
  return { engine, ada, board, ticket, get, unblocked }
}

describe('A ticket blocked by another (T266)', () => {
  it('links both ways, with any number of blockers', () => {
    const { board, ticket, get } = setup()
    const card = ticket('Retry a failed charge')
    const token = ticket('Refresh the card token')
    const expiry = ticket('Token expiry event')

    board().addBlocker(card.id, token.id)
    board().addBlocker(card.id, expiry.id)

    expect(get(card.id)).toMatchObject({ blockedBy: [token.id, expiry.id], blocks: [] })
    expect(get(token.id)).toMatchObject({ blockedBy: [], blocks: [card.id] })

    board().removeBlocker(card.id, token.id)
    expect(get(card.id).blockedBy).toEqual([expiry.id])
    expect(get(token.id).blocks).toEqual([])
  })

  it('refuses a direct loop in one sentence', () => {
    const { board, ticket } = setup()
    const a = ticket('Retry a failed charge')
    const b = ticket('Refresh the card token')
    board().addBlocker(a.id, b.id)

    expect(() => board().addBlocker(b.id, a.id)).toThrow(
      `AC-${a.id} already waits on AC-${b.id} — that would be a loop.`,
    )
    expect(() => board().addBlocker(a.id, a.id)).toThrow(/cannot wait on itself/)
  })

  it('refuses a longer loop too', () => {
    const { board, ticket, get } = setup()
    const a = ticket('One')
    const b = ticket('Two')
    const c = ticket('Three')
    board().addBlocker(a.id, b.id)
    board().addBlocker(b.id, c.id)

    expect(() => board().addBlocker(c.id, a.id)).toThrow(
      `AC-${a.id} already waits on AC-${c.id} — that would be a loop.`,
    )
    expect(get(c.id).blockedBy).toEqual([])
  })

  it('refuses to start a ticket that waits, naming the blocker and the way out', () => {
    const { board, ticket, get } = setup()
    const card = ticket('Retry a failed charge')
    const token = ticket('Refresh the card token')
    board().addBlocker(card.id, token.id)

    expect(() => board().moveTicket(card.id, 'doing')).toThrow(
      `AC-${card.id} waits on AC-${token.id}, which is not Done yet. Remove the blocker to start it now.`,
    )
    expect(get(card.id).column).toBe('todo')

    board().removeBlocker(card.id, token.id)
    expect(board().moveTicket(card.id, 'doing').column).toBe('doing')
  })

  it('keeps the manual flag independent of the links: a ticket can be both', () => {
    const { board, ticket, get } = setup()
    const card = ticket('Retry a failed charge')
    const token = ticket('Refresh the card token')
    board().addBlocker(card.id, token.id)

    board().updateTicket(card.id, { blocked: true, blockedReason: 'Waiting on the sandbox key' })
    expect(get(card.id)).toMatchObject({ blocked: true, blockedBy: [token.id] })

    board().updateTicket(card.id, { blocked: false })
    expect(get(card.id)).toMatchObject({ blocked: false, blockedBy: [token.id] })
  })

  it('tells the assignee once when the last blocker is Done, and records it, moving nothing', () => {
    const { engine, ada, board, ticket, get, unblocked } = setup()
    const card = ticket('Retry a failed charge', ada.id)
    const token = ticket('Refresh the card token')
    const expiry = ticket('Token expiry event')
    board().addBlocker(card.id, token.id)
    board().addBlocker(card.id, expiry.id)

    board().moveTicket(expiry.id, 'done')
    expect(unblocked()).toEqual([])

    board().moveTicket(token.id, 'done')
    // Moving it again inside Done sets nothing free a second time.
    board().moveTicket(token.id, 'done', 0)

    expect(unblocked()).toEqual([
      expect.objectContaining({ ticketId: card.id, text: 'Retry a failed charge', status: 'pending' }),
    ])
    expect(unblocked()[0]!.prompt).toContain(`AC-${card.id}`)
    expect(get(card.id).column).toBe('todo')
    expect(engine.activity.list({ limit: 50 }).filter((e) => e.kind === 'ticket_unblocked')).toEqual([
      expect.objectContaining({
        summary: `closed AC-${token.id}, the last blocker of AC-${card.id}, so it no longer waits`,
      }),
    ])
    expect(board().moveTicket(card.id, 'doing').column).toBe('doing')
  })

  it('tells an assignee of a ticket that waits not to start it yet', () => {
    const { ada, board, ticket, engine } = setup()
    const card = ticket('Retry a failed charge')
    const token = ticket('Refresh the card token')
    board().addBlocker(card.id, token.id)

    board().updateTicket(card.id, { assigneeId: ada.id })

    const assigned = engine.inbox.list(ada.id).find((item) => item.kind === 'assigned')!
    expect(assigned.prompt).toContain(`It waits on AC-${token.id}: do not claim or start it yet`)
    expect(assigned.prompt).not.toContain('ticket_claim')
  })
})
