import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READY } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, type Message } from '../../../shared/domain/chat'
import type { CompanyNotification } from '../../../shared/notifications'
import { type DailyDigest, QUIET_DAY } from '../../../shared/planning/daily-digest'
import type { UsageSnapshot } from '../../../shared/usage/provider-usage'
import type { OpenDatabase } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

/** The Company keeps its hours in Lisbon, where 18:00 is 17:00 UTC in September. */
const ZONE = 'Europe/Lisbon'
const FOLDER = '/work/acme'

/** Tuesday, an hour before the digest is due. */
const BEFORE = new Date('2026-09-22T16:00:00Z')
const DUE = new Date('2026-09-22T17:00:00Z')

const engines: CompanyEngine[] = []

/**
 * In-memory Companies that survive the app quitting, so a test can close the engine and open the
 * same Company again. `inMemoryDatabases` cannot: `close()` throws the database away with it.
 */
function reopenableDatabases(): OpenDatabase {
  const byFolder = new Map<string, DatabaseSync>()
  return (folder, mode) => {
    const existing = byFolder.get(folder)
    if (existing) return existing
    if (mode === 'existing') return null
    const real = new DatabaseSync(':memory:')
    real.exec('PRAGMA foreign_keys = ON')
    // Only the four members the engine uses; `close` is the one that has to do nothing.
    const kept = {
      exec: real.exec.bind(real),
      prepare: real.prepare.bind(real),
      close: () => {},
      get isOpen() {
        return real.isOpen
      },
    } as unknown as DatabaseSync
    byFolder.set(folder, kept)
    return kept
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: BEFORE })
})

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

const USAGE: UsageSnapshot = {
  readAt: '2026-09-22T17:00:00.000Z',
  providers: [
    {
      id: 'claude',
      name: 'Claude',
      windows: [{ key: 'five_hour', label: '5h', percent: 68, resetsAt: '2026-09-22T20:00:00Z' }],
      problem: null,
      reason: null,
      accounts: [],
    },
    {
      id: 'codex',
      name: 'Codex',
      windows: [],
      problem: 'unavailable',
      accounts: [],
      reason: 'Codex reports its limit in the Session',
    },
  ],
}

function start(databases: OpenDatabase = inMemoryDatabases(), usage = async () => USAGE) {
  const notifications: CompanyNotification[] = []
  const engine = createCompanyEngine({
    openDatabase: databases,
    recents: inMemoryRecents(),
    usage,
    log: () => {},
  })
  engines.push(engine)
  engine.notifications.onNotify((notification) => {
    notifications.push(notification)
  })
  return { engine, databases, notifications }
}

/** A Company keeping Lisbon hours, with a team and a board the digest has something to say about. */
function setup(usage = async () => USAGE) {
  const started = start(inMemoryDatabases(), usage)
  const { engine } = started
  engine.createCompany({ folder: onDisk(FOLDER), name: 'Acme' })
  engine.digest.setSchedule({ timezone: ZONE })
  const db = started.databases(onDisk(FOLDER), 'existing')!
  const orion = engine.employees.create({ name: 'Orion', roleId: 'backend' })
  const vega = engine.employees.create({ name: 'Vega', roleId: 'frontend' })
  return { ...started, db, orion, vega }
}

/** Lets the scheduled run, which reads usage over a promise, finish. */
async function runDue(): Promise<void> {
  await vi.advanceTimersByTimeAsync(DUE.getTime() - Date.now())
}

/** The digest posted in `#general`, or null when none was. */
function posted(engine: CompanyEngine): Message | null {
  return (
    engine
      .chat()
      .read({ channelId: 'general' })
      .find((m) => m.kind === 'digest') ?? null
  )
}

function digestOf(engine: CompanyEngine): DailyDigest {
  const message = posted(engine)
  if (!message?.digest) throw new Error('No digest was posted')
  return message.digest
}

/** A PR opened for a ticket and merged inside the window, as the review flow leaves it. */
function shipTicket(db: DatabaseSync, ticketId: number, repo: { id: string; name: string }, number: number) {
  db.prepare(
    'INSERT OR IGNORE INTO repo (id, name, path, language, framework, package_manager, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(repo.id, repo.name, onDisk(`/code/${repo.name}`), 'TypeScript', '', 'pnpm', BEFORE.toISOString())
  db.prepare('INSERT INTO pull_request (ticket_id, repo_id, url, number, opened_at) VALUES (?, ?, ?, ?, ?)').run(
    ticketId,
    repo.id,
    `https://github.com/acme/${repo.name}/pull/${number}`,
    number,
    BEFORE.toISOString(),
  )
  db.prepare('INSERT INTO merged_pull_request (ticket_id, repo_id, merged_at) VALUES (?, ?, ?)').run(
    ticketId,
    repo.id,
    new Date(BEFORE.getTime() + 60_000).toISOString(),
  )
}

/** A review round of `ticketId` waiting on `reviewerId`, as the review flow files one. */
function reviewRound(db: DatabaseSync, ticketId: number, reviewerId: string, messageId: number) {
  db.prepare(
    'INSERT INTO review (ticket_id, reviewer_id, status, message_id, requested_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ticketId, reviewerId, 'pending', messageId, BEFORE.toISOString())
}

describe('composing the digest', () => {
  it('says what shipped, what is in review, what is blocked, what waits and what is next', async () => {
    const { engine, db, orion, vega } = setup()
    const board = engine.board()
    const shipped = board.createTicket({ title: 'Invoice pagination', assigneeId: orion.id })
    const mine = board.createTicket({ title: 'Usage chart with range picker', assigneeId: vega.id })
    const theirs = board.createTicket({ title: 'Invoice PDF download', assigneeId: vega.id })
    const stuck = board.createTicket({ title: 'Proration on plan switch', assigneeId: orion.id })
    // Ready is the column an approved plan lets a ticket into (T171): that is what Tomorrow lists.
    const next = board.createTicket({ title: 'Invoice email template', assigneeId: vega.id, column: READY })
    board.createTicket({ title: 'Nobody has this one yet', column: READY })
    board.createTicket({ title: 'Still being planned', assigneeId: vega.id })
    // Ready and held, but it waits on a ticket still in Review (T266): nobody picks it up yet.
    const waits = board.createTicket({ title: 'Invoice reminder email', assigneeId: vega.id, column: READY })
    board.addBlocker(waits.id, mine.id)
    board.moveTicket(shipped.id, 'done')
    board.moveTicket(mine.id, 'review')
    board.moveTicket(theirs.id, 'review')
    board.updateTicket(stuck.id, { blocked: true, blockedReason: 'Needs a Stripe test key in billing-api' })
    shipTicket(db, shipped.id, { id: 'r-api', name: 'billing-api' }, 128)
    const round = engine.chat().post({ authorId: orion.id, channelId: 'prs', text: 'review please' })
    reviewRound(db, mine.id, BOSS, round.id)
    reviewRound(db, theirs.id, orion.id, round.id)
    engine.approvals.request({ requesterId: vega.id, action: 'merge', ticketId: theirs.id, reason: 'CI is green' })

    await runDue()
    const digest = digestOf(engine)

    expect(digest.shipped).toEqual([
      {
        ticketId: shipped.id,
        title: 'Invoice pagination',
        where: 'billing-api #128',
        url: expect.any(String),
        who: 'Orion',
      },
    ])
    expect(digest.inReview).toEqual([
      { ticketId: mine.id, title: 'Usage chart with range picker', where: '', readyForYou: true },
      { ticketId: theirs.id, title: 'Invoice PDF download', where: 'Orion reviewing', readyForYou: false },
    ])
    expect(digest.blocked).toEqual([
      { ticketId: stuck.id, title: 'Proration on plan switch', reason: 'Needs a Stripe test key in billing-api' },
    ])
    expect(digest.waiting.map((line) => line.kind)).toEqual(['Merge'])
    expect(digest.waiting[0]!.ticketId).toBe(theirs.id)
    // Tomorrow is what is assigned and Ready: not the unassigned one, not the one still in Planning,
    // not the one that waits.
    expect(digest.tomorrow).toEqual([{ ticketId: next.id, title: 'Invoice email template', who: 'Vega' }])
  })

  it('says what a plan waiting on the boss is, where the Inbox alone would say “mention” (T171)', async () => {
    const { engine, orion } = setup()
    const ticket = engine.board().createTicket({ title: 'Usage chart with range picker' })
    const planner = engine.planning.as(orion.id)
    planner.ask({ kind: 'ticket', id: ticket.id }, ['Which ranges?', 'Totals only?'])

    await runDue()
    const asking = digestOf(engine).waiting

    expect(asking.map((line) => [line.kind, line.ticketId])).toEqual([['Plan · 2 questions', ticket.id]])

    // Answered and drafted, the same row says what the boss now has to approve.
    const plan = engine.planning.of({ kind: 'ticket', id: ticket.id })!
    for (const question of plan.questions) engine.planning.answer(question.id, '7, 30 and 90 days.')
    planner.draft(
      { kind: 'ticket', id: ticket.id },
      {
        goal: 'A range picker',
        subtasks: [
          { title: 'API', repo: null },
          { title: 'UI', repo: null },
        ],
      },
    )
    // The next evening's digest, which the armed timer posts.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    const next = engine
      .chat()
      .read({ channelId: 'general' })
      .filter((m) => m.kind === 'digest')
      .at(-1)!.digest!

    expect(next.waiting.map((line) => line.kind)).toContain('Plan · 2 steps')
  })

  it('reads usage per Provider, and lets one that reports none say so', async () => {
    const { engine } = setup()

    await runDue()

    expect(digestOf(engine).usage).toEqual([
      { id: 'claude', name: 'Claude', percent: 68, window: '5h', resets: '21:00', problem: '' },
      {
        id: 'codex',
        name: 'Codex',
        percent: null,
        window: '',
        resets: '',
        problem: 'Codex reports its limit in the Session',
      },
    ])
  })

  it('counts only the PRs merged inside the window it covers', async () => {
    const { engine, db, orion } = setup()
    const old = engine.board().createTicket({ title: 'Shipped last week', assigneeId: orion.id })
    engine.board().moveTicket(old.id, 'done')
    shipTicket(db, old.id, { id: 'r-api', name: 'billing-api' }, 99)
    db.prepare('UPDATE merged_pull_request SET merged_at = ?').run('2026-09-15T10:00:00.000Z')

    await runDue()

    expect(digestOf(engine).shipped).toEqual([])
  })

  it('posts one line on a day with nothing in it', async () => {
    const { engine } = setup()

    await runDue()
    const message = posted(engine)

    expect(message?.text).toBe(QUIET_DAY)
    expect(message?.authorId).toBe(COMPANY_AUTHOR)
  })
})

describe('the schedule', () => {
  it('posts at the Company’s own time, once, and not again that day', async () => {
    const { engine } = setup()

    await runDue()
    expect(posted(engine)?.digest?.until).toBe(DUE.toISOString())

    // Another hour of the same day: the day is filed, so nothing else goes up.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(
      engine
        .chat()
        .read({ channelId: 'general' })
        .filter((m) => m.kind === 'digest'),
    ).toHaveLength(1)
  })

  it('posts nothing while it is off, and nothing on a day it does not name', async () => {
    const { engine } = setup()
    engine.digest.setSchedule({ enabled: false })

    await runDue()
    expect(posted(engine)).toBeNull()

    // Weekdays only: Saturday's 18:00 passes without a digest.
    engine.digest.setSchedule({ enabled: true, days: [6] })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(posted(engine)).toBeNull()
  })

  it('posts in the channel the boss chose', async () => {
    const { engine } = setup()
    engine.digest.setSchedule({ channelId: 'tech' })

    await runDue()

    expect(posted(engine)).toBeNull()
    expect(
      engine
        .chat()
        .read({ channelId: 'tech' })
        .some((m) => m.kind === 'digest'),
    ).toBe(true)
  })
})

describe('a run the app was closed for', () => {
  /** Creates a Company yesterday, closes the app, and opens it again at `at`. */
  async function reopenAt(at: string) {
    const databases = reopenableDatabases()
    const first = start(databases)
    first.engine.createCompany({ folder: onDisk(FOLDER), name: 'Acme' })
    first.engine.digest.setSchedule({ timezone: ZONE })
    first.engine.close()
    engines.splice(engines.indexOf(first.engine), 1)

    vi.setSystemTime(new Date(at))
    const second = start(databases)
    second.engine.openCompany(onDisk(FOLDER))
    // The run started on the way in reads usage over a promise before it posts.
    await vi.advanceTimersByTimeAsync(0)
    return second
  }

  it('posts the missed digest when the Company opens inside 12 hours', async () => {
    const { engine } = await reopenAt('2026-09-22T22:00:00Z')

    expect(posted(engine)?.digest?.until).toBe(DUE.toISOString())
  })

  it('skips it once it is more than 12 hours late, and the next one covers the gap', async () => {
    const { engine } = await reopenAt('2026-09-23T09:00:00Z')
    expect(posted(engine)).toBeNull()

    // That evening's digest reaches back over the day nobody saw.
    await vi.advanceTimersByTimeAsync(new Date('2026-09-23T17:00:00Z').getTime() - Date.now())
    const digest = digestOf(engine)

    expect(digest.until).toBe('2026-09-23T17:00:00.000Z')
    expect(digest.since).toBe('2026-09-22T17:00:00.000Z')
  })

  it('is not owed for a day the Company did not exist for', async () => {
    // The Company is made at 16:00 and the app is closed; opening it at 19:00 the same evening
    // finds a run at 15:00 that happened before it existed.
    const databases = reopenableDatabases()
    const first = start(databases)
    first.engine.createCompany({ folder: onDisk(FOLDER), name: 'Acme' })
    first.engine.digest.setSchedule({ timezone: ZONE, time: '15:00' })
    first.engine.close()
    engines.splice(engines.indexOf(first.engine), 1)

    vi.setSystemTime(new Date('2026-09-22T18:00:00Z'))
    const second = start(databases)
    second.engine.openCompany(onDisk(FOLDER))
    await vi.advanceTimersByTimeAsync(0)

    expect(posted(second.engine)).toBeNull()
  })
})

describe('what a digest does not do', () => {
  it('wakes no Employee and enters no inbox: it is the app talking, not a teammate', async () => {
    const { engine, orion, vega } = setup()
    const board = engine.board()
    const held = board.createTicket({ title: 'Invoice pagination', assigneeId: orion.id })
    board.moveTicket(held.id, 'doing')
    board.createTicket({ title: 'Usage alerts', assigneeId: vega.id })
    const before = [orion.id, vega.id].map((id) => engine.inbox.list(id).length)

    await runDue()

    expect(posted(engine)).not.toBeNull()
    expect([orion.id, vega.id].map((id) => engine.inbox.list(id).length)).toEqual(before)
  })

  it('never lands in the boss’s Inbox either: it is not addressed to anyone', async () => {
    const { engine } = setup()

    await runDue()

    expect(engine.chat().bossInbox()).toEqual([])
  })
})

describe('the notification', () => {
  it('rings with the day in one sentence, and opens the channel at the digest', async () => {
    const { engine, notifications } = setup()

    await runDue()
    const banner = notifications.find((n) => n.kind === 'digest')

    expect(banner?.title).toBe('Acme · Daily digest')
    expect(banner?.body).toBe(QUIET_DAY)
    expect(banner?.focus).toEqual({ kind: 'digest', channelId: 'general', messageId: posted(engine)!.id })
    expect(banner?.actions?.map((action) => action.label)).toEqual(['Later', 'Open digest'])
  })

  it('stays quiet when the digest is set not to notify', async () => {
    const { engine, notifications } = setup()
    engine.digest.setSchedule({ notify: false })

    await runDue()

    expect(posted(engine)).not.toBeNull()
    expect(notifications.filter((n) => n.kind === 'digest')).toEqual([])
  })

  it('stays quiet when the Company’s own notifications are off', async () => {
    const { engine, notifications } = setup()
    engine.notifications.setEnabled(false)

    await runDue()

    expect(posted(engine)).not.toBeNull()
    expect(notifications.filter((n) => n.kind === 'digest')).toEqual([])
  })
})

describe('when usage cannot be read at all', () => {
  it('still posts, with no usage section rather than an invented one', async () => {
    const { engine } = setup(async () => {
      throw new Error('the keychain is locked')
    })

    await runDue()

    expect(posted(engine)).not.toBeNull()
    expect(digestOf(engine).usage).toEqual([])
  })
})
