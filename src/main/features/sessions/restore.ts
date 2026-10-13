import type { DatabaseSync } from 'node:sqlite'
import { COLUMN_TITLES, type Ticket } from '../../../shared/domain/board'
import { BOSS, COMPANY_AUTHOR, dmMembers, type Mentionable } from '../../../shared/domain/chat'
import { ticketCode } from '../../../shared/ticket-id'
import type { Migration } from '../../core'
import { companyKeyOf } from '../../core'
import type { NewInboxItem } from '../inbox'
import type { Sessions } from './sessions'

/** How many recent messages a primed Session is told about. */
export const PRIMER_MESSAGES = 10
/** Longest a quoted message may be in a primer. */
const PRIMER_TEXT_CHARS = 280

/** Employees whose Session should come back when the Company opens: started, and not stopped by the boss. */
export const RESTORE_MIGRATION: Migration = {
  name: 'restore-session-restore',
  sql: `
  CREATE TABLE session_restore (
    employee_id TEXT PRIMARY KEY REFERENCES employee (id)
  );
`,
}

/** Bringing Sessions back when a Company opens, and priming the ones that come back without context. */
export interface Restore {
  /**
   * The Sessions everyone else sees: `start` remembers the Employee should come back on the
   * next open, `stop` forgets it. `stopAll` (the app closing) forgets nobody.
   */
  sessions: Sessions
  /**
   * Starts, resuming, every Session of the current Company that was running when it was last closed.
   *
   * A paused Company reopens paused (decision 38): what it is owed stays owed and `Resume all` is
   * what brings it back. That used to be true by accident, because a pause left nothing owed; a
   * pause row that outlived its holds let a reopen start the whole floor while the header still read
   * `Resume all` (T217).
   */
  reopened(): void
  /**
   * The Employees of the current Company whose Sessions should come back on the next open, in desk
   * order. `Pause all` holds these too, and `Resume all` falls back to them (T217).
   */
  restoring(): string[]
  /** Starts the Employee's Session, in the current Company, continuing its last conversation. */
  resume(employeeId: string): void
  /** Whether the Employee's next start should resume, because the Company reopened. Clears the mark. */
  takeResume(employeeId: string): boolean
  /** Files the catch-up prompt for an Employee whose Session started without its previous context. */
  prime(companyId: string, employeeId: string): void
}

export interface RestoreOptions {
  sessions: Sessions
  /**
   * Whether the current Company is paused, so a reopen leaves what it owes owed. Answered above
   * this layer, because the pause wraps it; without one, nothing is ever paused.
   */
  paused?(): boolean
  /** The current Company's database; throws when none is open. */
  current(): DatabaseSync
  /** An open Company's database, people and tickets, and its inbox, or null. */
  company(companyId: string): {
    db: DatabaseSync
    people: Mentionable[]
    tickets(): Ticket[]
    deliver(item: NewInboxItem): void
  } | null
  log(line: string): void
}

interface RecentMessage {
  id: number
  channel_id: string
  thread_id: number | null
  author_id: string
  text: string
}

export function createRestore({
  sessions: inner,
  paused = () => false,
  current,
  company,
  log,
}: RestoreOptions): Restore {
  /** Ids of Employees brought back by a reopen and not spawned yet, e.g. parked. */
  const toResume = new Set<string>()

  const sessions: Sessions = {
    ...inner,
    start(employeeId) {
      const started = inner.start(employeeId)
      current().prepare('INSERT INTO session_restore (employee_id) VALUES (?) ON CONFLICT DO NOTHING').run(employeeId)
      return started
    },
    stop(employeeId) {
      current().prepare('DELETE FROM session_restore WHERE employee_id = ?').run(employeeId)
      toResume.delete(employeeId)
      return inner.stop(employeeId)
    },
    stopAll() {
      toResume.clear()
      inner.stopAll()
    },
  }

  /** Who is marked to come back, in desk order. Throws only when the table is not there. */
  const marked = (): string[] =>
    (
      current()
        .prepare(
          `SELECT r.employee_id AS id FROM session_restore r
           JOIN employee e ON e.id = r.employee_id ORDER BY e.desk`,
        )
        .all() as { id: string }[]
    ).map(({ id }) => id)

  return {
    sessions,

    reopened() {
      if (paused()) return
      let ids: string[]
      try {
        ids = marked()
      } catch (error) {
        return log(`Restore: could not read which Sessions to bring back: ${(error as Error).message}`)
      }
      for (const id of ids) {
        toResume.add(id)
        try {
          inner.start(id)
        } catch (error) {
          toResume.delete(id)
          log(`Restore: could not bring back Employee ${id}: ${(error as Error).message}`)
        }
      }
    },

    restoring() {
      try {
        return marked()
      } catch (error) {
        log(`Restore: could not read which Sessions were running: ${(error as Error).message}`)
        return []
      }
    },

    resume(employeeId) {
      toResume.add(employeeId)
      try {
        sessions.start(employeeId)
      } catch (error) {
        toResume.delete(employeeId)
        throw error
      }
    },

    takeResume(employeeId) {
      return toResume.delete(employeeId)
    },

    prime(companyId, employeeId) {
      const open = company(companyId)
      if (!open) return
      const tickets = open.tickets().filter((t) => t.assigneeId === employeeId && t.column !== 'done')
      const messages = (
        open.db
          .prepare(
            `SELECT id, channel_id, thread_id, author_id, text FROM message
             WHERE author_id = ?
               OR id IN (SELECT message_id FROM inbox_item WHERE employee_id = ? AND message_id IS NOT NULL)
               OR id IN (SELECT f.message_id FROM inbox_item_message f
                         JOIN inbox_item i ON i.id = f.item_id WHERE i.employee_id = ?)
             ORDER BY id DESC LIMIT ?`,
          )
          .all(employeeId, employeeId, employeeId, PRIMER_MESSAGES) as unknown as RecentMessage[]
      ).reverse()
      const name = (id: string) =>
        id === BOSS || id === COMPANY_AUTHOR ? id : (open.people.find((p) => p.id === id)?.name ?? 'former employee')
      // Nothing to catch up on — no open ticket, no chat that concerns them — means the lost
      // conversation held no work either (a Session that never had a turn cannot be resumed). A
      // primer would wake every such Employee to be told there is nothing, on the boss's quota.
      if (tickets.length === 0 && messages.length === 0) {
        return log(`Restore: ${name(employeeId)}’s Session started fresh; it had nothing to catch up on`)
      }
      log(`Restore: ${name(employeeId)}’s Session could not be resumed; it started fresh and will be primed`)
      open.deliver({
        employeeId,
        kind: 'resume',
        fromId: COMPANY_AUTHOR,
        channelId: null,
        threadId: null,
        messageId: null,
        ticketId: tickets[0]?.id ?? null,
        text: 'Your previous Session could not be resumed: catch up on your ticket and recent chat.',
        prompt: primerPrompt(companyKeyOf(open.db), tickets, messages, name, employeeId),
      })
    },
  }
}

/** The catch-up prompt, on one line like every pushed prompt. */
function primerPrompt(
  companyKey: string,
  tickets: Ticket[],
  messages: RecentMessage[],
  name: (id: string) => string,
  employeeId: string,
): string {
  const quote = (text: string) =>
    JSON.stringify(text.length > PRIMER_TEXT_CHARS ? `${text.slice(0, PRIMER_TEXT_CHARS)}…` : text)
  const ticketLines = tickets.map((t) => {
    const done = t.subtasks.filter((s) => s.done).length
    const subtasks = t.subtasks.length ? `, ${done}/${t.subtasks.length} subtasks done` : ''
    const blocked = t.blocked ? `, blocked: ${quote(t.blockedReason)}` : ''
    return `${ticketCode(companyKey, t.id)} ${JSON.stringify(t.title)} (${COLUMN_TITLES[t.column]}${subtasks}${blocked})`
  })
  const messageLines = messages.map((m) => {
    const members = dmMembers(m.channel_id)
    const other = members?.find((id) => id !== employeeId)
    const where = members ? `DM with ${name(other ?? employeeId)}` : `#${m.channel_id}`
    const thread = m.thread_id === null ? '' : `, thread ${m.thread_id}`
    return `[${where}${thread}, message ${m.id}] ${name(m.author_id)}: ${quote(m.text)}`
  })
  return [
    '[company] restart: your previous Session could not be resumed, so this one starts without that conversation.',
    'Before anything else, run `git status` in each worktree you work in to find half-finished edits.',
    ticketLines.length
      ? `Your open tickets: ${ticketLines.join('; ')}. Read them with board_list.`
      : 'You hold no open ticket.',
    messageLines.length
      ? `Recent chat that concerns you, oldest first: ${messageLines.join(' | ')}.`
      : 'No recent chat concerns you.',
    'Your memory file is in your instructions. Then carry on where you left off, and reply through the ' +
      'company MCP server; never answer in plain text.',
  ].join(' ')
}
