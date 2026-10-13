import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { COMPANY_FILE } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, removeFolder } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { INBOX_MIGRATION } from '../inbox'
import { READY_DELAY_MS } from './sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  const juno = engine.employees.create({ name: 'Juno', roleId: 'backend' })

  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }

  // Assignment and reference wakes are not about planning, so these tickets skip Planning: a
  // ticket created there would also wake whoever holds `plan` (T171).
  const board = () => {
    const acting = engine.board()
    return {
      ...acting,
      createTicket: (input: Parameters<typeof acting.createTicket>[0]) =>
        acting.createTicket({ column: 'todo', ...input }),
    }
  }
  const post = (authorId: string, channelId: string, text: string) => engine.chat().post({ authorId, channelId, text })
  const inbox = (employeeId: string) => engine.inbox.list(employeeId)

  return { engine, ada, grace, juno, startIdle, board, post, inbox }
}

describe('Assignment wakes', () => {
  it('wakes the Employee a ticket is assigned to', () => {
    const { ada, grace, board, inbox } = setup()
    const ticket = board().createTicket({ title: 'Login page' })

    board().updateTicket(ticket.id, { assigneeId: ada.id })

    expect(inbox(ada.id)).toEqual([
      expect.objectContaining({
        kind: 'assigned',
        fromId: BOSS,
        ticketId: ticket.id,
        channelId: null,
        messageId: null,
        text: 'Login page',
        status: 'pending',
      }),
    ])
    expect(inbox(grace.id)).toEqual([])
  })

  it('wakes the assignee of a ticket created already assigned', () => {
    const { ada, board, inbox } = setup()

    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })

    expect(inbox(ada.id)).toEqual([expect.objectContaining({ kind: 'assigned', ticketId: ticket.id })])
  })

  it('pushes the assignment to an idle assignee, naming the ticket and how to start', () => {
    const { ada, startIdle, board } = setup()
    const session = startIdle(ada.id)

    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })

    expect(session.pushed).toHaveLength(1)
    expect(session.pushed[0]).toContain(`AC-${ticket.id}`)
    expect(session.pushed[0]).toContain('"Signup"')
    expect(session.pushed[0]).toContain('ticket_claim')
  })

  it('does not wake anyone when the assignee stays, leaves or is not an Employee', () => {
    const { ada, board, inbox } = setup()
    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })

    board().updateTicket(ticket.id, { title: 'Sign-up', assigneeId: ada.id })
    board().moveTicket(ticket.id, 'doing')
    board().updateTicket(ticket.id, { assigneeId: null })
    board().createTicket({ title: 'Ghost', assigneeId: 'nobody' })

    expect(inbox(ada.id)).toHaveLength(1)
  })

  it('wakes the new assignee on a reassignment', () => {
    const { ada, grace, board, inbox } = setup()
    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })

    board().updateTicket(ticket.id, { assigneeId: grace.id })

    expect(inbox(grace.id)).toEqual([expect.objectContaining({ kind: 'assigned', ticketId: ticket.id })])
    expect(inbox(ada.id)).toHaveLength(1)
  })
})

describe('Ticket reference wakes', () => {
  it('wakes the holder of a ticket referenced in a channel', () => {
    const { ada, grace, juno, board, post, inbox } = setup()
    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })

    const message = post(grace.id, 'tech', `is #${ticket.id} close?`)

    expect(inbox(ada.id)).toContainEqual(
      expect.objectContaining({
        kind: 'ticket',
        fromId: grace.id,
        channelId: 'tech',
        messageId: message.id,
        ticketId: ticket.id,
        text: `is #${ticket.id} close?`,
      }),
    )
    expect(inbox(juno.id)).toEqual([])
    expect(inbox(grace.id)).toEqual([])
  })

  it('tells the holder which ticket of theirs was referenced', () => {
    const { ada, grace, startIdle, board, post } = setup()
    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })
    const session = startIdle(ada.id)
    session.hook('UserPromptSubmit')
    session.hook('Stop')

    post(grace.id, 'tech', `is #${ticket.id} close?`)

    expect(session.pushed.at(-1)).toMatch(new RegExp(`your ticket AC-${ticket.id} from Grace in #tech`))
  })

  // Decision 33: `AC-1` is the display id and `#1` the short form; either one wakes the holder.
  it('wakes the holder for a reference by the display id too', () => {
    const { ada, grace, startIdle, board, post } = setup()
    const ticket = board().createTicket({ title: 'Signup', assigneeId: ada.id })
    const session = startIdle(ada.id)
    session.hook('UserPromptSubmit')
    session.hook('Stop')

    post(grace.id, 'tech', `is AC-${ticket.id} close?`)

    expect(session.pushed.at(-1)).toMatch(new RegExp(`your ticket AC-${ticket.id} from Grace in #tech`))
  })

  it('does not wake the holder for their own message, a done or an unheld ticket', () => {
    const { ada, board, post, inbox } = setup()
    const held = board().createTicket({ title: 'Signup', assigneeId: ada.id })
    const done = board().createTicket({ title: 'Old', assigneeId: ada.id, column: 'done' })
    const free = board().createTicket({ title: 'Free' })
    const before = inbox(ada.id).length

    post(ada.id, 'tech', `#${held.id} is done`)
    post(ada.id, 'general', `#${held.id} is done`)
    post(BOSS, 'tech', `#${done.id} and #${free.id} and #999`)

    // The boss's message is unread for Ada, who does not hold any ticket it names.
    expect(inbox(ada.id).filter((i) => i.status !== 'unread')).toHaveLength(before)
  })

  it('wakes the holder for a reference in #general as a ticket wake, not a #general one', () => {
    const { ada, board, post, inbox } = setup()
    const held = board().createTicket({ title: 'Signup', assigneeId: ada.id })
    const before = inbox(ada.id).length

    post(BOSS, 'general', `thanks for #${held.id}`)

    expect(inbox(ada.id).slice(before)).toEqual([expect.objectContaining({ kind: 'ticket', ticketId: held.id })])
  })

  it('files one item per holder with the most specific reason', () => {
    const { ada, board, post, inbox } = setup()
    const one = board().createTicket({ title: 'One', assigneeId: ada.id })
    const two = board().createTicket({ title: 'Two', assigneeId: ada.id })
    const before = inbox(ada.id).length

    post(BOSS, 'tech', `#${one.id} and #${two.id}`)
    post(BOSS, 'tech', `@Ada about #${one.id}`)
    post(BOSS, dmChannelId(BOSS, ada.id), `#${two.id}?`)

    expect(
      inbox(ada.id)
        .slice(before)
        .map((i) => i.kind),
    ).toEqual(['ticket', 'mention', 'dm'])
  })
})

describe('Epic channels', () => {
  it('creates a channel with each epic', () => {
    const { engine, board } = setup()

    const epic = board().createEpic({ title: 'Magic link login' })

    expect(engine.chat().channels()).toContainEqual(
      expect.objectContaining({ id: `epic-${epic.id}-magic-link-login`, kind: 'channel', members: [] }),
    )
  })

  it('makes the assignees of the epic’s tickets its members', () => {
    const { engine, ada, grace, board } = setup()
    const epic = board().createEpic({ title: 'Login' })
    const other = board().createEpic({ title: 'Billing' })

    board().createTicket({ title: 'API', epicId: epic.id, assigneeId: ada.id })
    const ui = board().createTicket({ title: 'UI', assigneeId: grace.id })
    board().updateTicket(ui.id, { epicId: epic.id })

    const channel = engine
      .chat()
      .channels()
      .find((c) => c.id === `epic-${epic.id}-login`)
    expect(channel?.members.sort()).toEqual([ada.id, grace.id].sort())
    expect(
      engine
        .chat()
        .channels()
        .find((c) => c.id === `epic-${other.id}-billing`)?.members,
    ).toEqual([])
  })

  it('wakes its members on any message there, but not the author or outsiders', () => {
    const { ada, grace, juno, board, post, inbox } = setup()
    const epic = board().createEpic({ title: 'Login' })
    board().createTicket({ title: 'API', epicId: epic.id, assigneeId: ada.id })
    board().createTicket({ title: 'UI', epicId: epic.id, assigneeId: grace.id })

    const message = post(grace.id, `epic-${epic.id}-login`, 'UI is ready for the API')

    expect(inbox(ada.id)).toContainEqual(
      expect.objectContaining({
        kind: 'epic',
        channelId: `epic-${epic.id}-login`,
        messageId: message.id,
        ticketId: null,
      }),
    )
    expect(inbox(grace.id).filter((i) => i.kind === 'epic')).toEqual([])
    expect(inbox(juno.id)).toEqual([])
  })

  it('wakes only its members on @channel', () => {
    const { ada, juno, board, post, inbox } = setup()
    const epic = board().createEpic({ title: 'Login' })
    board().createTicket({ title: 'API', epicId: epic.id, assigneeId: ada.id })

    post(BOSS, `#epic-${epic.id}-login`, '@channel status?')

    expect(inbox(ada.id).at(-1)).toMatchObject({ kind: 'channel' })
    expect(inbox(juno.id)).toEqual([])
  })

  it('keeps its channel name when the epic is renamed', () => {
    const { engine, board } = setup()
    const epic = board().createEpic({ title: 'Login' })

    board().updateEpic(epic.id, { title: 'Auth' })

    expect(
      engine
        .chat()
        .channels()
        .map((c) => c.id),
    ).toContain(`epic-${epic.id}-login`)
  })
})

describe('Upgrading a Company made before ticket wakes', () => {
  it('keeps inbox items and gives existing epics a channel with their assignees', () => {
    const folder = mkdtempSync(join(tmpdir(), 'ticket-wakes-'))
    try {
      const before = createCompanyEngine({ recents: inMemoryRecents() })
      before.createCompany({ folder })
      const ada = before.employees.create({ name: 'Ada', roleId: 'backend' })
      const epic = before.board().createEpic({ title: 'Login' })
      before.board().createTicket({ title: 'API', epicId: epic.id, assigneeId: ada.id })
      before.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada.id), text: 'hi' })
      before.close()
      undoTicketWakes(join(folder, COMPANY_FILE))

      const after = createCompanyEngine({ recents: inMemoryRecents() })
      engines.push(after)
      after.openCompany(folder)

      expect(after.chat().channels()).toContainEqual(
        expect.objectContaining({ id: `epic-${epic.id}`, kind: 'channel', members: [ada.id] }),
      )
      expect(after.inbox.list(ada.id)).toEqual([expect.objectContaining({ kind: 'dm', text: 'hi', ticketId: null })])
      const juno = after.employees.create({ name: 'Juno', roleId: 'backend' })
      after.chat().post({ authorId: juno.id, channelId: `epic-${epic.id}`, text: 'status?' })
      expect(after.inbox.list(ada.id).at(-1)).toMatchObject({ kind: 'epic' })
      after.close()
    } finally {
      removeFolder(folder)
    }
  })
})

/** Puts a Company file back to its schema before the ticket-wakes migration. */
function undoTicketWakes(file: string) {
  const db = new DatabaseSync(file)
  db.exec(`
    DELETE FROM schema_migration WHERE name = 'ticket-wakes-inbox-and-epic-channels';
    CREATE TABLE epic_channel_ids AS SELECT channel_id FROM epic_channel;
    DROP TABLE epic_channel;
    -- The plans opened in those channels go with them: this is the schema before planning too.
    DELETE FROM plan_question;
    DELETE FROM plan;
    CREATE TABLE epic_message_ids AS
      SELECT id FROM message WHERE channel_id IN (SELECT channel_id FROM epic_channel_ids);
    DELETE FROM inbox_item_message WHERE message_id IN (SELECT id FROM epic_message_ids);
    DELETE FROM inbox_item WHERE message_id IN (SELECT id FROM epic_message_ids);
    DELETE FROM message WHERE id IN (SELECT id FROM epic_message_ids);
    DROP TABLE epic_message_ids;
    DELETE FROM channel WHERE id IN (SELECT channel_id FROM epic_channel_ids);
    DROP TABLE epic_channel_ids;
    DROP INDEX inbox_item_by_employee;
    ALTER TABLE inbox_item RENAME TO inbox_item_new;
    ${INBOX_MIGRATION.sql}
    INSERT INTO inbox_item SELECT id, employee_id, kind, from_id, channel_id, thread_id, message_id,
      text, prompt, status, attempts, created_at, handled_at FROM inbox_item_new
      WHERE message_id IS NOT NULL;
    DROP TABLE inbox_item_new;
  `)
  db.close()
}
