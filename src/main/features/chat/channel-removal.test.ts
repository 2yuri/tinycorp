import { afterEach, describe, expect, it } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const FOLDER = onDisk('/work/acme')

function setup() {
  const openDatabase = inMemoryDatabases()
  const engine = createCompanyEngine({ openDatabase, recents: inMemoryRecents() })
  engines.push(engine)
  engine.createCompany({ folder: FOLDER, name: 'Acme' })
  // Production opens the file with foreign keys on; the in-memory opener does not, and this ticket
  // is about leaving nothing behind that points at a channel that is gone.
  const db = openDatabase(FOLDER, 'existing')!
  db.exec('PRAGMA foreign_keys = ON')
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...(params as never[])) as { n: number }).n
  return { engine, db, ada, grace, chat: () => engine.chat(), board: () => engine.board(), count }
}

/**
 * An epic with its channel, a ticket for each of Ada and Grace, and a thread they both answer in —
 * so the channel has messages, replies, inbox items, folded messages and a thread answerer.
 */
function epicWithTalk(s: ReturnType<typeof setup>) {
  const epic = s.board().createEpic({ title: 'Login' })
  const channelId = `epic-${epic.id}-login`
  s.board().createTicket({ title: 'API', epicId: epic.id, assigneeId: s.ada.id })
  s.board().createTicket({ title: 'UI', epicId: epic.id, assigneeId: s.grace.id })
  const root = s.chat().post({ authorId: BOSS, channelId, text: 'how far along?' })
  s.chat().reply({ authorId: s.ada.id, messageId: root.id, text: 'halfway' })
  s.chat().reply({ authorId: s.grace.id, messageId: root.id, text: 'UI is done' })
  return { epic, channelId, root }
}

describe('Deleting a channel', () => {
  it('says what goes with it before anything is deleted', () => {
    const s = setup()
    const { epic, channelId } = epicWithTalk(s)

    expect(s.chat().channelRemoval(channelId)).toEqual({
      channelId,
      name: channelId,
      // Three said, and three system lines: the epic's plan and one for each ticket (T171).
      messages: 6,
      epicId: epic.id,
    })
    expect(
      s
        .chat()
        .channels()
        .map((c) => c.id),
    ).toContain(channelId)
  })

  it('takes its messages, their threads, the boss’s read mark and its inbox items', () => {
    const s = setup()
    const { channelId, root } = epicWithTalk(s)
    s.chat().markReadByBoss(channelId)
    expect(s.engine.inbox.list(s.ada.id).some((i) => i.channelId === channelId)).toBe(true)
    expect(s.count('chat_read_mark WHERE channel_id = ?', channelId)).toBe(1)

    s.chat().deleteChannel(channelId)

    expect(
      s
        .chat()
        .channels()
        .map((c) => c.id),
    ).not.toContain(channelId)
    expect(s.count('message WHERE channel_id = ?', channelId)).toBe(0)
    expect(s.count('message WHERE thread_id = ?', root.id)).toBe(0)
    expect(s.count('chat_read_mark WHERE channel_id = ?', channelId)).toBe(0)
    expect(s.count('inbox_item WHERE channel_id = ?', channelId)).toBe(0)
    expect(s.engine.inbox.list(s.ada.id).some((i) => i.channelId === channelId)).toBe(false)
  })

  it('leaves nothing pointing at the channel that is gone', () => {
    const s = setup()
    const { channelId } = epicWithTalk(s)
    // The rows that would dangle: the epic link, the messages folded into a thread item, and the
    // Employee the thread kept as its answerer.
    expect(s.count('epic_channel WHERE channel_id = ?', channelId)).toBe(1)
    expect(s.count('inbox_item_message')).toBeGreaterThan(0)
    expect(s.count('thread_answerer')).toBeGreaterThan(0)

    s.chat().deleteChannel(channelId)

    expect(s.count('epic_channel WHERE channel_id = ?', channelId)).toBe(0)
    expect(
      s.count(
        `inbox_item_message
          WHERE message_id NOT IN (SELECT id FROM message)
             OR item_id NOT IN (SELECT id FROM inbox_item)`,
      ),
    ).toBe(0)
    expect(s.count('thread_answerer WHERE thread_id NOT IN (SELECT id FROM message)')).toBe(0)
    expect(s.count('message WHERE channel_id NOT IN (SELECT id FROM channel)')).toBe(0)
    expect(s.count('inbox_item WHERE channel_id IS NOT NULL AND channel_id NOT IN (SELECT id FROM channel)')).toBe(0)
  })

  it('leaves the other channels and their messages alone', () => {
    const s = setup()
    const { channelId } = epicWithTalk(s)
    s.chat().post({ authorId: BOSS, channelId: 'general', text: 'morning all' })

    s.chat().deleteChannel(channelId)

    expect(
      s
        .chat()
        .read({ channelId: 'general' })
        .map((m) => m.text),
    ).toEqual(['morning all'])
  })

  it('unlinks the epic, which keeps its tickets and simply has no channel', () => {
    const s = setup()
    const { epic, channelId } = epicWithTalk(s)

    s.chat().deleteChannel(channelId)

    expect(
      s
        .board()
        .snapshot()
        .epics.map((e) => e.id),
    ).toContain(epic.id)
    expect(
      s
        .board()
        .snapshot()
        .tickets.map((t) => t.epicId),
    ).toContain(epic.id)
    expect(s.count('epic_channel WHERE epic_id = ?', epic.id)).toBe(0)
  })

  it('wakes nobody through an epic channel that is gone, and does not bring it back', () => {
    const s = setup()
    const { epic, channelId } = epicWithTalk(s)

    s.chat().deleteChannel(channelId)
    const before = s.engine.inbox.list(s.grace.id).length
    // Straight to Ready: a ticket that started in Planning would also file Grace a planning item (T171).
    const ticket = s
      .board()
      .createTicket({ title: 'Checkout', column: 'todo', epicId: epic.id, assigneeId: s.grace.id })
    const filed = s.engine.inbox.list(s.grace.id).slice(before)

    expect(
      s
        .chat()
        .channels()
        .map((c) => c.id),
    ).not.toContain(channelId)
    expect(filed).toEqual([expect.objectContaining({ kind: 'assigned', ticketId: ticket.id })])
    expect(filed[0]!.prompt).not.toContain(channelId)
    expect(() => s.chat().post({ authorId: BOSS, channelId, text: 'anyone?' })).toThrow(/no channel/)
  })

  it('still gives the next epic its own channel', () => {
    const s = setup()
    const { channelId } = epicWithTalk(s)
    s.chat().deleteChannel(channelId)

    const next = s.board().createEpic({ title: 'Billing' })

    expect(
      s
        .chat()
        .channels()
        .map((c) => c.id),
    ).toContain(`epic-${next.id}-billing`)
    expect(s.count('epic_channel WHERE epic_id = ? AND channel_id = ?', next.id, `epic-${next.id}-billing`)).toBe(1)
  })

  it('refuses the Company’s own channels, which the instructions name', () => {
    const s = setup()

    for (const id of ['general', 'tech', 'prs']) {
      expect(() => s.chat().deleteChannel(id)).toThrow(/own channels/)
    }
    expect(
      s
        .chat()
        .channels()
        .map((c) => c.id),
    ).toEqual(['general', 'tech', 'prs'])
  })

  it('refuses a DM, opened or not', () => {
    const s = setup()
    const opened = dmChannelId(BOSS, s.ada.id)
    s.chat().post({ authorId: BOSS, channelId: opened, text: 'hi' })

    expect(() => s.chat().deleteChannel(opened)).toThrow(/direct message/i)
    expect(() => s.chat().deleteChannel(dmChannelId(s.ada.id, s.grace.id))).toThrow(/direct message/i)
    expect(
      s
        .chat()
        .read({ channelId: opened })
        .map((m) => m.text),
    ).toEqual(['hi'])
  })

  it('refuses a channel that is not there', () => {
    const s = setup()

    expect(() => s.chat().deleteChannel('epic-99-nope')).toThrow(/no channel/)
  })
})

describe('a daily digest posted in a channel that is deleted (T172)', () => {
  it('goes with it, and the schedule moves back to #general', () => {
    const s = setup()
    const { channelId } = epicWithTalk(s)
    s.engine.digest.setSchedule({ channelId })
    s.chat().postDigest({
      channelId,
      text: 'Quiet day.',
      digest: {
        day: '2026-09-22',
        since: '2026-09-21T17:00:00.000Z',
        until: '2026-09-22T17:00:00.000Z',
        shipped: [],
        inReview: [],
        blocked: [],
        waiting: [],
        usage: [],
        tomorrow: [],
        footer: '',
      },
    })
    expect(s.count('digest')).toBe(1)

    s.chat().deleteChannel(channelId)

    // Nothing is left pointing at a message that is gone, and the next digest has a home.
    expect(s.count('digest')).toBe(0)
    expect(s.engine.digest.schedule().channelId).toBe('general')
  })
})
