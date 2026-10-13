import type { DatabaseSync } from 'node:sqlite'
import type { Approval } from '../../../shared/approvals'
import { APPROVAL_KIND_LABEL } from '../../../shared/approvals/approval-summary'
import { READY } from '../../../shared/domain/board'
import { BOSS } from '../../../shared/domain/chat'
import type { BossInboxItem, BossInboxKind } from '../../../shared/inbox/boss-inbox'
import {
  type BlockedLine,
  type DailyDigest,
  DEFAULT_DIGEST_SCHEDULE,
  type DigestSchedule,
  type DigestScheduleUpdate,
  digestDay,
  digestFooter,
  digestSummary,
  dueRun,
  nextRunAt,
  type ReviewLine,
  requireSchedule,
  type ShippedLine,
  type TomorrowLine,
  type UsageLine,
  type WaitingLine,
} from '../../../shared/planning/daily-digest'
import { type Plan, unanswered, waitsOnBoss } from '../../../shared/planning/planning'
import { wallClock } from '../../../shared/platform/wall-clock'
import type { UsageSnapshot } from '../../../shared/usage/provider-usage'
import type { Migration } from '../../core'

/**
 * The daily digest of one Company (T172): the schedule it keeps, the digest it composes from its
 * own tables, and the timer that posts it.
 *
 * Nothing in here talks to a Provider. Every line is a row the app already has, which is what makes
 * a digest free: the boss gets the day's summary without an Employee spending a token on it.
 */

/** The digest's migration step, appended to the engine's migrations. */
export const DAILY_DIGEST_MIGRATION: Migration = {
  name: 'chat-daily-digest',
  sql: `
  CREATE TABLE digest_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL,
    time TEXT NOT NULL,
    days TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    notify INTEGER NOT NULL,
    timezone TEXT
  );
  CREATE TABLE digest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES message (id),
    day TEXT NOT NULL UNIQUE,
    since TEXT NOT NULL,
    until TEXT NOT NULL,
    body TEXT NOT NULL
  );
  ALTER TABLE message ADD COLUMN kind TEXT NOT NULL DEFAULT 'post';
`,
}

/** The window a digest covers when the Company has never posted one. */
export const FIRST_DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000

/** What the Waiting on you column calls each kind of Inbox row (decision 43). */
export const WAITING_KIND_LABEL: Record<BossInboxKind, string> = {
  asking: 'Permission',
  approval: 'Approval',
  plan: 'Plan',
  waiting: 'Waiting for capacity',
  dm: 'Direct message',
  mention: 'Mention',
  thread: 'Reply',
}

/** The Company's schedule, or the default for one that has never been asked. */
export function readSchedule(db: DatabaseSync): DigestSchedule {
  const row = db.prepare('SELECT * FROM digest_setting WHERE id = 1').get() as ScheduleRow | undefined
  if (!row) return { ...DEFAULT_DIGEST_SCHEDULE, days: [...DEFAULT_DIGEST_SCHEDULE.days] }
  return {
    enabled: row.enabled === 1,
    time: row.time,
    days: JSON.parse(row.days) as number[],
    channelId: row.channel_id,
    notify: row.notify === 1,
    timezone: row.timezone,
  }
}

/** Checks the whole schedule, then writes it. One wrong field changes nothing. */
export function writeSchedule(db: DatabaseSync, update: DigestScheduleUpdate): DigestSchedule {
  const next = requireSchedule(update, readSchedule(db))
  db.prepare(
    `INSERT INTO digest_setting (id, enabled, time, days, channel_id, notify, timezone)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       enabled = excluded.enabled, time = excluded.time, days = excluded.days,
       channel_id = excluded.channel_id, notify = excluded.notify, timezone = excluded.timezone`,
  ).run(next.enabled ? 1 : 0, next.time, JSON.stringify(next.days), next.channelId, next.notify ? 1 : 0, next.timezone)
  return next
}

/** The days a digest has already been posted for, so none is ever posted twice. */
export function postedDays(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT day FROM digest').all() as { day: string }[]
  return new Set(rows.map((row) => row.day))
}

/** The end of the last digest's window, which is where the next one starts. */
export function lastDigestUntil(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT until FROM digest ORDER BY id DESC LIMIT 1').get() as { until: string } | undefined
  return row?.until ?? null
}

/** The digests of several messages at once, by message id; messages that carry none are left out. */
export function digestsOfMany(db: DatabaseSync, messageIds: readonly number[]): Map<number, DailyDigest> {
  if (messageIds.length === 0) return new Map()
  const rows = db
    .prepare(`SELECT message_id, body FROM digest WHERE message_id IN (${messageIds.map(() => '?').join(', ')})`)
    .all(...messageIds) as { message_id: number; body: string }[]
  return new Map(rows.map((row) => [row.message_id, JSON.parse(row.body) as DailyDigest]))
}

/** Everything composing a digest reads besides the Company's own tables. */
export interface DigestSources {
  db: DatabaseSync
  /** The boss's Inbox, exactly as the Inbox view reads it (decision 43). */
  bossInbox(): BossInboxItem[]
  /** Pending Approvals, so a waiting row can name the ticket and the kind it is about. */
  approvals(): Approval[]
  /** The newest plan of every subject (T171): a plan waiting on the boss is a row of its own. */
  plans(): Plan[]
  /** What each Provider reports of the subscription, or an empty snapshot when nothing read. */
  usage: UsageSnapshot
  schedule: DigestSchedule
  /** The window the digest covers. */
  since: Date
  until: Date
}

/**
 * The digest for one window, composed from the Company's tables. Empty sections stay empty; the
 * card is what leaves them out, so a stored digest always says exactly what was true.
 */
export function composeDigest(sources: DigestSources): DailyDigest {
  const { db, schedule, since, until } = sources
  return {
    day: digestDay(until, schedule),
    since: since.toISOString(),
    until: until.toISOString(),
    shipped: shippedIn(db, since, until),
    inReview: inReview(db),
    blocked: blocked(db),
    waiting: waitingOnBoss(sources),
    usage: usageLines(sources.usage, schedule),
    tomorrow: readyTickets(db),
    footer: digestFooter(schedule),
  }
}

/** The PRs merged inside the window, oldest first: what shipped. */
function shippedIn(db: DatabaseSync, since: Date, until: Date): ShippedLine[] {
  const rows = db
    .prepare(
      `SELECT m.ticket_id, m.repo_id, t.title, t.assignee_id, r.name AS repo_name, p.url, p.number
       FROM merged_pull_request m
       JOIN ticket t ON t.id = m.ticket_id
       LEFT JOIN repo r ON r.id = m.repo_id
       LEFT JOIN pull_request p ON p.ticket_id = m.ticket_id AND p.repo_id = m.repo_id
       WHERE m.merged_at > ? AND m.merged_at <= ?
       ORDER BY m.merged_at, m.ticket_id, m.repo_id`,
    )
    .all(since.toISOString(), until.toISOString()) as unknown as ShippedRow[]
  const names = employeeNames(db)
  return rows.map((row) => ({
    ticketId: row.ticket_id,
    title: row.title,
    where: prLabel(row.repo_name ?? row.repo_id, row.number),
    url: row.url ?? '',
    who: row.assignee_id ? (names.get(row.assignee_id) ?? '') : '',
  }))
}

/** Tickets sitting in Review, with the round each one is in. */
function inReview(db: DatabaseSync): ReviewLine[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.title,
              (SELECT v.reviewer_id FROM review v WHERE v.ticket_id = t.id ORDER BY v.id DESC LIMIT 1) AS reviewer_id,
              (SELECT v.status FROM review v WHERE v.ticket_id = t.id ORDER BY v.id DESC LIMIT 1) AS status
       FROM ticket t
       WHERE t.column_id = 'review'
       ORDER BY t.position, t.id`,
    )
    .all() as unknown as ReviewTicketRow[]
  const names = employeeNames(db)
  return rows.map((row) => {
    const readyForYou = row.reviewer_id === BOSS && row.status === 'pending'
    const reviewer = row.reviewer_id ? (names.get(row.reviewer_id) ?? '') : ''
    const pulls = pullRequestLabels(db, row.id)
    const parts = [reviewer && `${reviewer} reviewing`, pulls.join(' · ')].filter(Boolean)
    return { ticketId: row.id, title: row.title, where: readyForYou ? '' : parts.join(' · '), readyForYou }
  })
}

/** Blocked tickets that are not yet Done, with the reason whoever blocked them gave. */
function blocked(db: DatabaseSync): BlockedLine[] {
  const rows = db
    .prepare(
      `SELECT id, title, blocked_reason FROM ticket
       WHERE blocked = 1 AND column_id <> 'done' ORDER BY position, id`,
    )
    .all() as { id: number; title: string; blocked_reason: string }[]
  return rows.map((row) => ({
    ticketId: row.id,
    title: row.title,
    reason: row.blocked_reason.trim() || 'No reason given',
  }))
}

/**
 * Everything waiting on the boss, read from the Inbox itself rather than queried again: the digest
 * and the Inbox row count can then never disagree about what is owed.
 */
function waitingOnBoss({ db, bossInbox, approvals, plans }: DigestSources): WaitingLine[] {
  const pending = new Map(approvals().map((approval) => [approval.id, approval]))
  const waitingPlans = plansByMessage(plans())
  const doing = ticketsInDoing(db)
  return bossInbox()
    .filter((item) => item.unread || item.kind === 'asking' || isPending(item, pending))
    .map((item) => {
      const approval = item.approvalId === null ? undefined : pending.get(item.approvalId)
      const plan = waitingPlans.get(item.messageId)
      const kind = approval
        ? APPROVAL_KIND_LABEL[approval.action]
        : plan
          ? planKind(plan)
          : WAITING_KIND_LABEL[item.kind]
      const ticketId =
        approval?.ticketId ?? plan?.ticketId ?? (item.kind === 'asking' ? (doing.get(item.fromId) ?? null) : null)
      return {
        id: item.id,
        ticketId,
        text: item.text,
        kind,
        channelId: item.channelId,
        threadId: item.threadId,
      }
    })
}

/**
 * The plans that wait on the boss (T171), by the message each one speaks through: the Plan card's,
 * and the message carrying its questions. A plan says what it is on its row — `Plan · 4 steps`,
 * `Plan · 2 questions` — where the Inbox alone would only say `Mention`.
 */
function plansByMessage(plans: readonly Plan[]): Map<number, Plan> {
  const byMessage = new Map<number, Plan>()
  for (const plan of plans) {
    if (!waitsOnBoss(plan)) continue
    if (plan.messageId !== null) byMessage.set(plan.messageId, plan)
    for (const question of plan.questions) {
      if (question.messageId !== null) byMessage.set(question.messageId, plan)
    }
  }
  return byMessage
}

/** `Plan · 4 steps`, or `Plan · 2 questions` while the planner is still asking. */
function planKind(plan: Plan): string {
  const open = unanswered(plan).length
  if (open > 0) return `Plan · ${open} question${open === 1 ? '' : 's'}`
  const steps = plan.subtasks.length
  return steps === 0 ? 'Plan' : `Plan · ${steps} step${steps === 1 ? '' : 's'}`
}

/** Whether an Inbox row is an Approval the boss has not decided yet. */
function isPending(item: BossInboxItem, pending: ReadonlyMap<number, Approval>): boolean {
  return item.approvalId !== null && pending.has(item.approvalId)
}

/**
 * Tickets someone could pick up next: in Ready — the column an approved plan lets a ticket into
 * (T171) — with a holder, and not blocked. A ticket still in Planning is nobody's tomorrow, and
 * neither is one that waits on a ticket not yet Done (T266).
 */
function readyTickets(db: DatabaseSync): TomorrowLine[] {
  const rows = db
    .prepare(
      `SELECT id, title, assignee_id FROM ticket
       WHERE column_id = ? AND assignee_id IS NOT NULL AND blocked = 0
         AND NOT EXISTS (
           SELECT 1 FROM ticket_dependency d JOIN ticket b ON b.id = d.blocked_by_id
           WHERE d.ticket_id = ticket.id AND b.column_id <> 'done'
         )
       ORDER BY position, id`,
    )
    .all(READY) as { id: number; title: string; assignee_id: string }[]
  const names = employeeNames(db)
  return rows.map((row) => ({
    ticketId: row.id,
    title: row.title,
    who: names.get(row.assignee_id) ?? 'Former employee',
  }))
}

/**
 * One line per Provider. A Provider that reports nothing says why, in its own words: the digest
 * never draws a zero it did not read (T80).
 */
export function usageLines(snapshot: UsageSnapshot, schedule: Pick<DigestSchedule, 'timezone'>): UsageLine[] {
  return snapshot.providers.map((provider) => {
    const window = provider.windows.find((w) => w.key === 'five_hour') ?? provider.windows[0]
    if (!window) {
      return {
        id: provider.id,
        name: provider.name,
        percent: null,
        window: '',
        resets: '',
        problem: provider.reason?.trim() || 'reports no usage',
      }
    }
    return {
      id: provider.id,
      name: provider.name,
      percent: Math.round(window.percent),
      window: window.label,
      resets: window.resetsAt ? clockIn(new Date(window.resetsAt), schedule.timezone) : '',
      problem: '',
    }
  })
}

/**
 * What the Company owes right now, or null: the run to post, and the window it covers.
 *
 * A run from before the Company existed is not owed — a Company made this evening has no day to
 * sum up — so the first digest is the first scheduled time after it was created.
 */
export function dueDigest(
  db: DatabaseSync,
  schedule: DigestSchedule,
  now: Date,
): { at: Date; day: string; since: Date } | null {
  const run = dueRun(schedule, now, postedDays(db))
  if (!run) return null
  const born = companyCreatedAt(db)
  if (born && run.at <= born) return null
  const last = lastDigestUntil(db)
  const earliest = new Date(run.at.getTime() - FIRST_DIGEST_WINDOW_MS)
  const since = last ? new Date(last) : born && born > earliest ? born : earliest
  return { ...run, since }
}

/** When the Company was made; null for a database that does not say. */
function companyCreatedAt(db: DatabaseSync): Date | null {
  const row = db.prepare('SELECT created_at FROM company').get() as { created_at: string } | undefined
  const at = row ? new Date(row.created_at) : null
  return at && !Number.isNaN(at.getTime()) ? at : null
}

/** How a merged or open PR is named on a line: `billing-api #128`, or the repo alone. */
function prLabel(repo: string, number: number | null): string {
  return number === null ? repo : `${repo} #${number}`
}

function pullRequestLabels(db: DatabaseSync, ticketId: number): string[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(r.name, p.repo_id) AS repo_name, p.number
       FROM pull_request p LEFT JOIN repo r ON r.id = p.repo_id
       WHERE p.ticket_id = ? ORDER BY p.repo_id`,
    )
    .all(ticketId) as { repo_name: string; number: number | null }[]
  return rows.map((row) => prLabel(row.repo_name, row.number))
}

/** The one ticket each Employee has in Doing, for the rows that are a Session asking. */
function ticketsInDoing(db: DatabaseSync): Map<string, number> {
  const rows = db
    .prepare(`SELECT id, assignee_id FROM ticket WHERE column_id = 'doing' AND assignee_id IS NOT NULL`)
    .all() as { id: number; assignee_id: string }[]
  const held = new Map<string, number>()
  for (const row of rows) {
    if (held.has(row.assignee_id)) held.set(row.assignee_id, -1)
    else held.set(row.assignee_id, row.id)
  }
  return new Map([...held].filter(([, id]) => id !== -1))
}

function employeeNames(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare('SELECT id, name FROM employee').all() as { id: string; name: string }[]
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** `21:00` on a clock in the schedule's zone. */
function clockIn(at: Date, timezone: string | null): string {
  const wall = wallClock(at, timezone ?? undefined)
  if (!wall) return ''
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
}

interface ScheduleRow {
  enabled: number
  time: string
  days: string
  channel_id: string
  notify: number
  timezone: string | null
}

interface ShippedRow {
  ticket_id: number
  repo_id: string
  title: string
  assignee_id: string | null
  repo_name: string | null
  url: string | null
  number: number | null
}

interface ReviewTicketRow {
  id: number
  title: string
  reviewer_id: string | null
  status: string | null
}

/** What one open Company hands the digest service. */
export interface DigestCompany {
  db: DatabaseSync
  name: string
  bossInbox(): BossInboxItem[]
  approvals(): Approval[]
  /** The newest plan of every subject, so a plan waiting on the boss says so on its row (T171). */
  plans(): Plan[]
  /** Posts the digest in its channel and stores it; answers with the message that carries it. */
  post(input: { channelId: string; text: string; digest: DailyDigest }): { id: number }
  /** Rings the boss, where the Company's own notifications are on. */
  notify(input: { messageId: number; channelId: string; digest: DailyDigest; companyName: string }): void
}

export interface DailyDigestOptions {
  /** An open Company's side of the digest, or null when it is not open. */
  company(companyId: string): DigestCompany | null
  /** Every open Company, so a timer that fires covers them all. */
  openCompanyIds(): string[]
  /** What each Provider reports; the digest asks once per run. Without one, it says nothing about usage. */
  usage?(): Promise<UsageSnapshot>
  now?(): number
  log(line: string): void
  /** Called after a digest is posted, so the views redraw. */
  onPosted?(companyId: string): void
}

/** The Company's own digest settings, as Company settings reads and writes them. */
export interface DigestSchedules {
  schedule(companyId: string): DigestSchedule
  setSchedule(companyId: string, update: DigestScheduleUpdate): DigestSchedule
}

export interface DailyDigests extends DigestSchedules {
  /**
   * Posts whatever a Company owes: at the scheduled time while the app runs, and once more when a
   * Company opens, for the run that was missed while it was closed (T172).
   */
  run(companyId: string): Promise<void>
  /** Re-arms the timer after a Company opens, closes, or changes its schedule. */
  rearm(): void
  close(): void
}

export function createDailyDigests({
  company,
  openCompanyIds,
  usage,
  now = Date.now,
  log,
  onPosted,
}: DailyDigestOptions): DailyDigests {
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  /** One Company at a time: the run is async, and two overlapping ones would compose it twice. */
  const running = new Set<string>()

  function databaseOf(companyId: string): DigestCompany {
    const open = company(companyId)
    if (!open) throw new Error(`Company ${companyId} is not open`)
    return open
  }

  async function runOne(companyId: string): Promise<void> {
    const open = company(companyId)
    if (!open?.db.isOpen || running.has(companyId)) return
    running.add(companyId)
    try {
      const schedule = readSchedule(open.db)
      const due = dueDigest(open.db, schedule, new Date(now()))
      if (!due) return
      // The usage read is the one thing here that leaves the process, and it never costs the
      // digest: a read that fails outright leaves the section out rather than the day unposted.
      const snapshot = await readUsage()
      if (closed || !open.db.isOpen) return
      // Read again: the await gave another run, or another window, the chance to file this day.
      if (postedDays(open.db).has(due.day)) return
      const digest = composeDigest({
        db: open.db,
        bossInbox: open.bossInbox,
        approvals: open.approvals,
        plans: open.plans,
        usage: snapshot,
        schedule,
        since: due.since,
        until: due.at,
      })
      const message = open.post({ channelId: schedule.channelId, text: digestSummary(digest), digest })
      if (schedule.notify) {
        open.notify({ messageId: message.id, channelId: schedule.channelId, digest, companyName: open.name })
      }
      onPosted?.(companyId)
    } catch (error) {
      log(`Daily digest: could not post ${companyId}’s: ${(error as Error).message}`)
    } finally {
      running.delete(companyId)
    }
  }

  /** What the Providers report, or nothing at all when the read itself fails. */
  async function readUsage(): Promise<UsageSnapshot> {
    if (!usage) return { providers: [], readAt: null }
    try {
      return await usage()
    } catch (error) {
      log(`Daily digest: could not read usage: ${(error as Error).message}`)
      return { providers: [], readAt: null }
    }
  }

  /**
   * The next instant any open Company owes a digest at. A Company whose tables cannot be read —
   * a database with an odd history — is skipped rather than kept from opening at all.
   */
  function nextWake(): Date | null {
    let soonest: Date | null = null
    for (const companyId of openCompanyIds()) {
      const open = company(companyId)
      if (!open?.db.isOpen) continue
      try {
        const at = nextRunAt(readSchedule(open.db), new Date(now()))
        if (at && (!soonest || at < soonest)) soonest = at
      } catch (error) {
        log(`Daily digest: ${companyId} has no schedule to keep: ${(error as Error).message}`)
      }
    }
    return soonest
  }

  function arm(): void {
    if (timer) clearTimeout(timer)
    timer = null
    if (closed) return
    const at = nextWake()
    if (!at) return
    // A timeout longer than a signed 32-bit millisecond count fires at once, so a schedule a week
    // out is woken in steps; each wake re-arms from what the schedules then say.
    const delay = Math.min(Math.max(0, at.getTime() - now()), 2_147_000_000)
    timer = setTimeout(() => {
      timer = null
      void Promise.all(openCompanyIds().map((companyId) => runOne(companyId))).then(arm, arm)
    }, delay)
    timer.unref?.()
  }

  return {
    schedule: (companyId) => readSchedule(databaseOf(companyId).db),

    setSchedule(companyId, update) {
      const next = writeSchedule(databaseOf(companyId).db, update)
      arm()
      return next
    },

    run: (companyId) => runOne(companyId),

    rearm: arm,

    close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      running.clear()
    },
  }
}
