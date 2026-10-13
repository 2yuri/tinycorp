import type { DatabaseSync } from 'node:sqlite'
import { BOSS, COMPANY_AUTHOR, dmMembers, type Mentionable, type Message } from '../../../shared/domain/chat'
import { type AnswererChoice, type Employee, resolveAnswerer, type Unavailability } from '../../../shared/domain/staff'
import type { AnswererSetting } from '../../../shared/inbox/answerer'
import { CAPACITY_NOTICE } from '../../../shared/inbox/boss-inbox'
import type { Migration } from '../../core'
import { companyKeyOf } from '../../core'
import type { Chat } from '../chat'
import type { Sessions } from '../sessions'
import { threadContext, threadPrompt } from '../sessions'
import { ANSWERER_HINT, inboxPrompt, type NewInboxItem } from './inbox'

/**
 * One voice (decision 41): the boss's "Who answers you" choice, and the answerer each thread keeps
 * whatever the setting later says.
 */
export const ANSWERER_MIGRATION: Migration = {
  name: 'company-answerer-and-thread-answerers',
  sql: `
  ALTER TABLE company ADD COLUMN answerer_id TEXT;
  CREATE TABLE thread_answerer (
    thread_id INTEGER PRIMARY KEY REFERENCES message (id),
    employee_id TEXT NOT NULL REFERENCES employee (id)
  );
`,
}

/** What Company settings do with the answerer: the current Company's "Who answers you" row. */
export interface Answerers {
  get(): AnswererSetting
  /** Sets the boss's choice; null goes back to Automatic. */
  set(employeeId: string | null): AnswererSetting
  /** Called after the setting, the staff or a Session's availability changes it. */
  onChange(listener: () => void): () => void
}

/** The engine's side: the chain of any open Company, and what a boss message does to it. */
export interface AnswererService extends Answerers {
  /** The chain of an open Company, availability and the boss's choice applied. */
  choice(companyId: string): AnswererChoice
  /** Who answers an unaddressed boss message in an open Company, or who it waits for. Null with no Employees. */
  answererId(companyId: string): string | null
  /** The Employee who answers the boss in a thread, kept from when the thread started. */
  threadAnswererId(companyId: string, threadId: number): string | null
  /**
   * Files `message` as answered by `answererId`: keeps them as its thread's answerer and, when
   * nobody was available, says in the chat that it waits. Returns a note for the answerer's prompt.
   */
  answered(companyId: string, message: Message, answererId: string): string
  /** Hires and fires of an open Company: the first hire's first item, and a fired answerer's threads. */
  staffChanged(companyId: string): void
  close(): void
}

export interface AnswererOptions {
  /** Every Session's status, for who is parked, out of budget or off. */
  sessions: Sessions
  /** An open Company, or null. */
  company(companyId: string): {
    db: DatabaseSync
    employees: Employee[]
    people: Mentionable[]
    chat: Chat
    /** Files an inbox item for this Company. */
    deliver(item: NewInboxItem): void
  } | null
  /** The current Company's id; throws when none is open. */
  currentId(): string
}

/** How the chat says a message waits, so the boss knows why nobody replied. It opens with
 * `CAPACITY_NOTICE`, which is how the boss's Inbox recognises it (decision 43). */
export function waitingLine(name: string): string {
  return `${CAPACITY_NOTICE} ${name} will answer when a slot frees.`
}

export function createAnswerers({ sessions, company, currentId }: AnswererOptions): AnswererService {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  /** The last status seen for every Session; an Employee never seen has no process. */
  const status = new Map<string, string>()
  /** The Employees each open Company had when it was last looked at, by id and name. */
  const staff = new Map<string, Map<string, string>>()

  const stopActivity = sessions.onActivity(({ employeeId, status: next }) => {
    const before = status.get(employeeId)
    status.set(employeeId, next)
    if (unavailableFor(before) !== unavailableFor(next)) notify()
  })

  function unavailableFor(state: string | undefined): Unavailability | null {
    if (state === 'parked') return 'parked'
    if (state === 'out_of_budget') return 'out_of_budget'
    return state === 'starting' || state === 'idle' || state === 'busy' ? null : 'stopped'
  }

  const isPaused = (db: DatabaseSync) => db.prepare('SELECT 1 FROM company_pause WHERE id = 1').get() !== undefined

  function overrideOf(db: DatabaseSync): string | null {
    const row = db.prepare('SELECT answerer_id AS id FROM company').get() as { id?: string | null } | undefined
    return row?.id ?? null
  }

  function chainOf(companyId: string, overrideId: string | null | undefined): AnswererChoice {
    const open = company(companyId)
    if (!open) return { answerer: null, first: null, skipped: [], override: null }
    const paused = isPaused(open.db)
    return resolveAnswerer(open.employees, {
      overrideId: overrideId === undefined ? overrideOf(open.db) : overrideId,
      unavailable: (employee) => (paused ? 'paused' : unavailableFor(status.get(employee.id))),
    })
  }

  function setting(companyId: string): AnswererSetting {
    const choice = chainOf(companyId, undefined)
    const automatic = chainOf(companyId, null)
    return {
      overrideId: choice.override?.id ?? null,
      automaticId: automatic.answerer?.id ?? null,
      answererId: choice.answerer?.id ?? null,
      waitingForId: choice.answerer ? null : (choice.first?.id ?? null),
      stale: choice.override?.stale ?? null,
      skipped: choice.skipped.map((s) => ({ employeeId: s.employee.id, reason: s.reason })),
    }
  }

  function nameOf(companyId: string, employeeId: string): string {
    if (employeeId === BOSS) return BOSS
    return company(companyId)?.people.find((p) => p.id === employeeId)?.name ?? 'former employee'
  }

  /** The newest boss message in a named channel nobody answered: the first hire's first item. */
  function lastUnansweredBossMessage(db: DatabaseSync): Message | null {
    const rows = db
      .prepare(
        `SELECT m.id, m.channel_id AS channelId, m.thread_id AS threadId, m.author_id AS authorId, m.text,
                m.mentions, m.mentions_channel AS mentionsChannel, m.created_at AS createdAt
         FROM message m
         WHERE m.author_id = ? AND m.thread_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM message r
             WHERE r.id > m.id AND r.author_id NOT IN (?, ?)
               AND (r.thread_id = m.id OR (r.channel_id = m.channel_id AND r.thread_id IS NULL))
           )
         ORDER BY m.id DESC`,
      )
      .all(BOSS, BOSS, COMPANY_AUTHOR) as unknown as (Omit<Message, 'mentions' | 'mentionsChannel' | 'replyCount'> & {
      mentions: string
      mentionsChannel: number
    })[]
    const row = rows.find((m) => dmMembers(m.channelId) === null)
    return row
      ? {
          ...row,
          mentions: JSON.parse(row.mentions) as string[],
          mentionsChannel: row.mentionsChannel === 1,
          replyCount: 0,
        }
      : null
  }

  /** What the Company itself last said in a channel, so the same line is not repeated. */
  function lastCompanyLine(db: DatabaseSync, channelId: string): string | null {
    const row = db
      .prepare('SELECT text FROM message WHERE channel_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1')
      .get(channelId, COMPANY_AUTHOR) as { text: string } | undefined
    return row?.text ?? null
  }

  /** The threads a fired answerer leaves open: their last word is not the one anyone waits on. */
  function openThreadsOf(db: DatabaseSync, employeeId: string): number[] {
    const rows = db
      .prepare(
        `SELECT t.thread_id AS threadId FROM thread_answerer t WHERE t.employee_id = ?
         AND (SELECT m.author_id FROM message m
              WHERE (m.id = t.thread_id OR m.thread_id = t.thread_id) AND m.author_id != ?
              ORDER BY m.id DESC LIMIT 1) != ?
         ORDER BY t.thread_id`,
      )
      .all(employeeId, COMPANY_AUTHOR, employeeId) as unknown as { threadId: number }[]
    return rows.map((r) => r.threadId)
  }

  function handOver(companyId: string, firedId: string, firedName: string): void {
    const open = company(companyId)
    if (!open) return
    const heir = chainOf(companyId, undefined)
    const heirId = heir.answerer?.id ?? heir.first?.id
    if (!heirId) return
    const threads = openThreadsOf(open.db, firedId)
    open.db.prepare('UPDATE thread_answerer SET employee_id = ? WHERE employee_id = ?').run(heirId, firedId)
    for (const threadId of threads) {
      const context = threadContext(open.db, threadId, [])
      const root = open.db.prepare('SELECT channel_id AS channelId FROM message WHERE id = ?').get(threadId) as
        | { channelId: string }
        | undefined
      if (!root) continue
      open.deliver({
        employeeId: heirId,
        kind: 'thread',
        fromId: BOSS,
        channelId: root.channelId,
        threadId,
        messageId: threadId,
        ticketId: null,
        text: context.root?.text ?? '',
        prompt: threadPrompt(root.channelId, threadId, context, (id) => nameOf(companyId, id), firedName),
      })
    }
  }

  function firstItemOf(companyId: string, employeeId: string): void {
    const open = company(companyId)
    if (!open) return
    const message = lastUnansweredBossMessage(open.db)
    if (!message) return
    open.db
      .prepare('INSERT INTO thread_answerer (thread_id, employee_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(message.id, employeeId)
    open.deliver({
      employeeId,
      kind: 'intake',
      fromId: message.authorId,
      channelId: message.channelId,
      threadId: null,
      messageId: message.id,
      ticketId: null,
      text: message.text,
      prompt: inboxPrompt(
        companyKeyOf(open.db),
        { kind: 'intake', ticketId: null },
        message,
        BOSS,
        `${ANSWERER_HINT} It was said before you were hired and nobody has answered it.`,
      ),
    })
  }

  const service: AnswererService = {
    get: () => setting(currentId()),

    set(employeeId) {
      const companyId = currentId()
      const open = company(companyId)!
      if (employeeId !== null && !open.employees.some((e) => e.id === employeeId)) {
        throw new Error(`Unknown Employee: ${employeeId}`)
      }
      open.db.prepare('UPDATE company SET answerer_id = ?').run(employeeId)
      notify()
      return setting(companyId)
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    choice: (companyId) => chainOf(companyId, undefined),

    answererId(companyId) {
      const choice = chainOf(companyId, undefined)
      return choice.answerer?.id ?? choice.first?.id ?? null
    },

    threadAnswererId(companyId, threadId) {
      const open = company(companyId)
      const row = open?.db.prepare('SELECT employee_id AS id FROM thread_answerer WHERE thread_id = ?').get(threadId) as
        | { id: string }
        | undefined
      return row && open!.employees.some((e) => e.id === row.id) ? row.id : null
    },

    answered(companyId, message, answererId) {
      const open = company(companyId)
      if (!open) return ''
      const threadId = message.threadId ?? message.id
      open.db
        .prepare('INSERT INTO thread_answerer (thread_id, employee_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(threadId, answererId)
      const choice = chainOf(companyId, undefined)
      const skipped = choice.skipped.filter((s) => s.employee.id !== answererId)
      if (!choice.answerer) {
        // A team that is merely off is not short of capacity: the item waits for its Session as
        // ever, and the chat stays quiet. Only a parked, paused or out-of-budget team is announced,
        // and only once per channel until something changes.
        const line = waitingLine(nameOf(companyId, answererId))
        if (
          !choice.skipped.every((s) => s.reason === 'stopped') &&
          lastCompanyLine(open.db, message.channelId) !== line
        ) {
          open.chat.post({ authorId: COMPANY_AUTHOR, channelId: message.channelId, text: line })
          return 'Nobody is available right now, so this waits for you.'
        }
        return ''
      }
      return skipped.length
        ? `${skipped.map((s) => `${s.employee.name} is ${s.reason.replace('_', ' ')}`).join(', ')}, so it is yours.`
        : ''
    },

    staffChanged(companyId) {
      const open = company(companyId)
      if (!open) return
      const now = new Map(open.employees.map((e) => [e.id, e.name]))
      const before = staff.get(companyId)
      staff.set(companyId, now)
      if (!before) return
      for (const [id, name] of before) if (!now.has(id)) handOver(companyId, id, name)
      const first = open.employees[0]
      if (before.size === 0 && first) firstItemOf(companyId, first.id)
      notify()
    },

    close() {
      stopActivity()
      listeners.clear()
      status.clear()
      staff.clear()
    },
  }
  return service
}
