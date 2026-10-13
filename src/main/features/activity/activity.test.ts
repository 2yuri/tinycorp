import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../shared/activity'
import { BOSS } from '../../../shared/domain/chat'
import { ACTIVITY_MIGRATION, type ActivityLog, createActivityLog } from './activity'

function newDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(ACTIVITY_MIGRATION.sql)
  return db
}

function newLog(recorded: ActivityEvent[] = []): ActivityLog {
  return createActivityLog({ db: newDatabase(), onRecorded: (event) => recorded.push(event) })
}

describe('the activity log', () => {
  let log: ActivityLog
  let recorded: ActivityEvent[]

  beforeEach(() => {
    recorded = []
    log = newLog(recorded)
  })

  it('appends an event and reads it back whole', () => {
    const event = log.record({
      kind: 'ticket_moved',
      actorId: 'e1',
      actorName: 'Ada',
      summary: 'moved TC-318 to Doing',
      subject: { kind: 'ticket', id: '318', label: 'TC-318' },
      detail: 'Silent token refresh before submit',
      code: ['Doing'],
      badge: { label: 'Needs review', tone: 'primary' },
      payload: { column: 'doing' },
    })

    expect(log.list()).toEqual([event])
    expect(event).toMatchObject({
      kind: 'ticket_moved',
      actorId: 'e1',
      actorName: 'Ada',
      subject: { kind: 'ticket', id: '318', label: 'TC-318' },
      summary: 'moved TC-318 to Doing',
      detail: 'Silent token refresh before submit',
      code: ['Doing'],
      badge: { label: 'Needs review', tone: 'primary' },
      payload: { column: 'doing' },
    })
    expect(recorded).toEqual([event])
  })

  it('reads newest first', () => {
    log.record({ kind: 'ticket_created', actorId: BOSS, actorName: 'Yuri', summary: 'created TC-1' })
    log.record({ kind: 'ticket_created', actorId: BOSS, actorName: 'Yuri', summary: 'created TC-2' })

    expect(log.list().map((e) => e.summary)).toEqual(['created TC-2', 'created TC-1'])
  })

  it('filters by kind group, actor and free text', () => {
    log.record({ kind: 'ticket_created', actorId: BOSS, actorName: 'Yuri', summary: 'created TC-1' })
    log.record({ kind: 'merged', actorId: 'e1', actorName: 'Ada', summary: 'merged payments-web #479' })
    log.record({ kind: 'message_posted', actorId: 'e1', actorName: 'Ada', summary: 'posted in #general' })

    expect(log.list({ groups: ['code'] }).map((e) => e.kind)).toEqual(['merged'])
    expect(log.list({ groups: ['code', 'tickets'] }).map((e) => e.kind)).toEqual(['merged', 'ticket_created'])
    expect(log.list({ actorId: 'e1' }).map((e) => e.kind)).toEqual(['message_posted', 'merged'])
    expect(log.list({ search: 'payments' }).map((e) => e.kind)).toEqual(['merged'])
    expect(log.list({ actorId: BOSS, groups: ['code'] })).toEqual([])
  })

  it('searches the subject label and treats wildcards as text', () => {
    log.record({
      kind: 'ticket_moved',
      actorId: 'e1',
      actorName: 'Ada',
      summary: 'moved a ticket',
      subject: { kind: 'ticket', id: '318', label: 'TC-318' },
    })

    expect(log.list({ search: 'tc-318' })).toHaveLength(1)
    expect(log.list({ search: '%' })).toEqual([])
  })

  it('honours a limit', () => {
    for (let i = 0; i < 5; i++) {
      log.record({ kind: 'ticket_created', actorId: BOSS, actorName: 'Yuri', summary: `created TC-${i}` })
    }

    expect(log.list({ limit: 2 }).map((e) => e.summary)).toEqual(['created TC-4', 'created TC-3'])
  })

  it('goes quiet once its Company is closed, so a late flow cannot throw', () => {
    const db = newDatabase()
    const closed = createActivityLog({ db })
    closed.record({ kind: 'merged', actorId: 'e1', actorName: 'Ada', summary: 'merged TC-1' })
    db.close()

    expect(closed.record({ kind: 'merged', actorId: 'e1', actorName: 'Ada', summary: 'merged TC-2' }).id).toBe(0)
    expect(closed.list()).toEqual([])
    expect(closed.actors()).toEqual([])
  })

  it('lists the actors it has seen, by their latest name', () => {
    log.record({ kind: 'ticket_created', actorId: 'e1', actorName: 'Ada', summary: 'created TC-1' })
    log.record({ kind: 'ticket_created', actorId: BOSS, actorName: 'Yuri', summary: 'created TC-2' })
    log.record({ kind: 'ticket_created', actorId: 'e1', actorName: 'Ada Lorne', summary: 'created TC-3' })

    expect(log.actors()).toEqual([
      { id: 'e1', name: 'Ada Lorne' },
      { id: BOSS, name: 'Yuri' },
    ])
  })
})
