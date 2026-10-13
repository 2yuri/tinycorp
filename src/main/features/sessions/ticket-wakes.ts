import type { DatabaseSync } from 'node:sqlite'
import type { Epic, NewEpic, Ticket } from '../../../shared/domain/board'
import { BOSS, type Mentionable, type Message } from '../../../shared/domain/chat'
import { openBlockers, unblockedBy } from '../../../shared/ticket-links'
import { epicChannelName, parseTicketRefs } from '../../../shared/ticket-refs'
import type { Migration } from '../../core'
import { companyKeyOf, ticketCodeIn } from '../../core'
import type { Board } from '../board'
import type { NewInboxItem, WakeContext } from '../inbox'

/**
 * The migration step of ticket wakes, appended to the engine's migrations: inbox items that are
 * not chat messages (assignments) and may name a ticket, and one channel per epic. Epics that
 * already exist get an `epic-<id>` channel whose members are their tickets' assignees.
 */
export const TICKET_WAKES_MIGRATION: Migration = {
  name: 'ticket-wakes-inbox-and-epic-channels',
  sql: `
  CREATE TABLE inbox_item_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL REFERENCES employee (id),
    kind TEXT NOT NULL,
    from_id TEXT NOT NULL,
    channel_id TEXT,
    thread_id INTEGER,
    message_id INTEGER REFERENCES message (id),
    ticket_id INTEGER REFERENCES ticket (id),
    text TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    handled_at TEXT
  );
  INSERT INTO inbox_item_next
    (id, employee_id, kind, from_id, channel_id, thread_id, message_id, text, prompt, status,
     attempts, created_at, handled_at)
    SELECT id, employee_id, kind, from_id, channel_id, thread_id, message_id, text, prompt, status,
      attempts, created_at, handled_at
    FROM inbox_item;
  DROP TABLE inbox_item;
  ALTER TABLE inbox_item_next RENAME TO inbox_item;
  CREATE INDEX inbox_item_by_employee ON inbox_item (employee_id, status, id);

  CREATE TABLE epic_channel (
    epic_id INTEGER PRIMARY KEY REFERENCES epic (id),
    channel_id TEXT NOT NULL UNIQUE REFERENCES channel (id)
  );
  INSERT INTO channel (id, kind, name, members, position)
    SELECT 'epic-' || id, 'channel', 'epic-' || id, '[]',
      (SELECT COALESCE(MAX(position), -1) + 1 FROM channel) + id
    FROM epic;
  INSERT INTO epic_channel (epic_id, channel_id) SELECT id, 'epic-' || id FROM epic;
  UPDATE channel SET members = (
    SELECT json_group_array(DISTINCT t.assignee_id)
    FROM epic_channel ec
    JOIN ticket t ON t.epic_id = ec.epic_id
    JOIN employee e ON e.id = t.assignee_id
    WHERE ec.channel_id = channel.id
  )
  WHERE id IN (SELECT channel_id FROM epic_channel);
`,
}

/** Databases posting a line that must wake nobody. */
const quiet = new WeakSet<DatabaseSync>()

/**
 * Posts one of the Company's own system lines — "You created TC-142 — it starts in Planning"
 * (T171) — without waking anyone: not the ticket's holder for the reference in it, not the epic
 * channel's members for the post. Whoever the line is for is woken by an inbox item of its own,
 * so the line is something to read, never a second wake.
 */
export function withoutWakes<T>(db: DatabaseSync, post: () => T): T {
  quiet.add(db)
  try {
    return post()
  } finally {
    quiet.delete(db)
  }
}

/** The board as one participant uses it: edits wake the Employees they concern. */
export interface ActingBoard extends Board {
  /** Also creates the epic's channel, with the acting Employee and `members` (Employee ids) in it. */
  createEpic(input: NewEpic & { members?: string[] }): Epic
  /** The id of an epic's channel. */
  epicChannel(epicId: number): string | null
}

/** One Company's link between its board, its chat and its inboxes. */
export interface TicketWakes {
  /** The board acting as `actorId`: the boss or an Employee id. */
  boardAs(actorId: string): ActingBoard
  /** What the board says about a new message, for the wake rules. */
  context(message: Message): WakeContext
}

export interface TicketWakesOptions {
  db: DatabaseSync
  board: Board
  people(): Mentionable[]
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** Called after an epic channel is created or gains members. */
  channelsChanged(): void
}

export function createTicketWakes({ db, board, people, deliver, channelsChanged }: TicketWakesOptions): TicketWakes {
  function epicChannel(epicId: number): string | null {
    const row = db.prepare('SELECT channel_id FROM epic_channel WHERE epic_id = ?').get(epicId) as
      | { channel_id: string }
      | undefined
    return row?.channel_id ?? null
  }

  function membersOf(channelId: string): string[] {
    const row = db.prepare('SELECT members FROM channel WHERE id = ?').get(channelId) as { members: string } | undefined
    return row ? (JSON.parse(row.members) as string[]) : []
  }

  function isEmployee(id: string): boolean {
    return people().some((p) => p.id === id)
  }

  /** Adds Employees to an epic's channel; returns whether anyone was new. */
  function join(epicId: number, employeeIds: string[]): boolean {
    const channelId = epicChannel(epicId)
    if (!channelId) return false
    const members = membersOf(channelId)
    const added = [...new Set(employeeIds)].filter((id) => !members.includes(id))
    if (added.length === 0) return false
    db.prepare('UPDATE channel SET members = ? WHERE id = ?').run(JSON.stringify([...members, ...added]), channelId)
    return true
  }

  function assignmentPrompt(ticket: Ticket, fromName: string): string {
    const channel = ticket.epicId === null ? null : epicChannel(ticket.epicId)
    // A ticket that waits is not picked up (T266): the assignee is told what it waits on, and told
    // again, once, when the last of it is Done.
    const open = ticket.blockedBy.length === 0 ? [] : openBlockers(ticket, board.snapshot().tickets)
    const start =
      open.length === 0
        ? ` Read it with board_list, then ticket_claim ${ticket.id} when you start.`
        : ` It waits on ${open.map((t) => ticketCodeIn(db, t.id)).join(', ')}: do not claim or start it yet —` +
          ' you are told when the last of them is Done.'
    return (
      `[company] ticket ${ticketCodeIn(db, ticket.id)} assigned to you by ${fromName}: ${JSON.stringify(ticket.title)}` +
      (channel ? ` (epic channel #${channel})` : '') +
      start +
      ' Talk through the company MCP server, never in plain text.'
    )
  }

  function unblockedPrompt(ticket: Ticket, blocker: Ticket): string {
    return (
      `[company] ${ticketCodeIn(db, ticket.id)} ${JSON.stringify(ticket.title)} no longer waits: ` +
      `${ticketCodeIn(db, blocker.id)}, the last of its blockers, is Done. ` +
      `ticket_claim ${ticket.id} when you start. Talk through the company MCP server, never in plain text.`
    )
  }

  return {
    boardAs(actorId) {
      const fromName = actorId === BOSS ? BOSS : (people().find((p) => p.id === actorId)?.name ?? 'former employee')

      function ticketChanged(ticket: Ticket, before: string | null): void {
        const assignee = ticket.assigneeId
        if (assignee === null || !isEmployee(assignee)) return
        if (ticket.epicId !== null && join(ticket.epicId, [assignee])) channelsChanged()
        if (assignee === before || assignee === actorId) return
        deliver({
          employeeId: assignee,
          kind: 'assigned',
          fromId: actorId,
          channelId: null,
          threadId: null,
          messageId: null,
          ticketId: ticket.id,
          text: ticket.title,
          prompt: assignmentPrompt(ticket, fromName),
        })
      }

      return {
        ...board,

        createEpic({ members = [], ...input }) {
          const stranger = members.find((id) => !isEmployee(id))
          if (stranger !== undefined) throw new Error(`There is no Employee ${stranger}`)
          const epic = board.createEpic(input)
          db.prepare(
            `INSERT INTO channel (id, kind, name, members, position)
             VALUES (?, 'channel', ?, '[]', (SELECT COALESCE(MAX(position), -1) + 1 FROM channel))`,
          ).run(epicChannelName(epic), epicChannelName(epic))
          db.prepare('INSERT INTO epic_channel (epic_id, channel_id) VALUES (?, ?)').run(epic.id, epicChannelName(epic))
          join(epic.id, isEmployee(actorId) ? [actorId, ...members] : members)
          channelsChanged()
          return epic
        },

        createTicket(input) {
          const ticket = board.createTicket(input)
          ticketChanged(ticket, null)
          return ticket
        },

        moveTicket(id, column, index) {
          const was = db.prepare('SELECT column_id FROM ticket WHERE id = ?').get(id) as
            | { column_id: string }
            | undefined
          const ticket = board.moveTicket(id, column, index)
          if (column !== 'done' || was?.column_id === 'done' || ticket.blocks.length === 0) return ticket
          // The last blocker Done: each ticket it set free tells its holder, once, through the
          // inbox every assignment already goes through. Nothing moves by itself.
          for (const freed of unblockedBy(ticket, board.snapshot().tickets)) {
            const assignee = freed.assigneeId
            if (assignee === null || assignee === actorId || !isEmployee(assignee)) continue
            deliver({
              employeeId: assignee,
              kind: 'unblocked',
              fromId: actorId,
              channelId: null,
              threadId: null,
              messageId: null,
              ticketId: freed.id,
              text: freed.title,
              prompt: unblockedPrompt(freed, ticket),
            })
          }
          return ticket
        },

        updateTicket(id, changes) {
          const row = db.prepare('SELECT assignee_id FROM ticket WHERE id = ?').get(id) as
            | { assignee_id: string | null }
            | undefined
          const before = row?.assignee_id ?? null
          const ticket = board.updateTicket(id, changes)
          ticketChanged(ticket, before)
          return ticket
        },

        epicChannel,
      }
    },

    context(message) {
      if (quiet.has(db)) return { holders: new Map(), epicMembers: null }
      const holderOf = db.prepare(
        `SELECT assignee_id FROM ticket WHERE id = ? AND column_id != 'done' AND assignee_id IS NOT NULL`,
      )
      const holders = new Map<number, string>()
      for (const ticketId of parseTicketRefs(message.text, companyKeyOf(db))) {
        const row = holderOf.get(ticketId) as { assignee_id: string } | undefined
        if (row) holders.set(ticketId, row.assignee_id)
      }
      const isEpic = db.prepare('SELECT 1 FROM epic_channel WHERE channel_id = ?').get(message.channelId)
      return { holders, epicMembers: isEpic ? membersOf(message.channelId) : null }
    },
  }
}
