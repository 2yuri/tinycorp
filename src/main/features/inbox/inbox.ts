import type { DatabaseSync } from 'node:sqlite'
import { type ColleagueVoice, DEFAULT_COLLEAGUE_VOICE, voiceHint } from '../../../shared/colleague-voice'
import { BOSS, dmMembers, type Mentionable, type Message } from '../../../shared/domain/chat'
import type { InboxItem, InboxStatus, WakeKind } from '../../../shared/inbox'
import { slashAttempt } from '../../../shared/providers/slash-commands'
import { ticketCode } from '../../../shared/ticket-id'
import type { Migration } from '../../core'
import { companyKeyOf, createVoiceSettings } from '../../core'
import type { SessionActivity, Sessions } from '../sessions'
import { generalPrompt, isGeneralPost, quietedIn, repliedTo, threadContext, threadPrompt } from '../sessions'

/** How long a pushed prompt may wait for its UserPromptSubmit before it is retried once. */
export const PUSH_CONFIRM_TIMEOUT_MS = 10_000

/** Employees' inboxes: what woke them, and whether it was delivered. */
export interface Inbox {
  /** Every item of an Employee of the current Company, oldest first. */
  list(employeeId: string): InboxItem[]
  /** Called after any inbox item is created or changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

/** The engine's side of the inbox. */
export interface InboxService extends Inbox {
  /** Files an item for everyone `message` wakes, and pushes it to those who are idle. */
  wake(companyId: string, message: Message): void
  /**
   * Files one item with its own prompt and pushes it if the Employee is idle: about a message,
   * like an approval decision, or not about a message at all, like an assignment.
   */
  deliver(companyId: string, item: NewInboxItem | MessageInboxItem): void
  close(): void
}

export interface InboxOptions {
  /**
   * An open Company's database, the people in it and what the board says about a message,
   * or null when it is not open.
   */
  company(companyId: string): {
    db: DatabaseSync
    people: Mentionable[]
    context?(message: Message): WakeContext
    /**
     * Called once `answererId` is filed an unaddressed boss message: keeps them as the thread's
     * answerer and says in the chat when the message waits for capacity. Returns a note for their prompt.
     */
    answered?(message: Message, answererId: string): string
    /**
     * `prompt` as the message that invokes the skill called `name` on this Employee's Provider
     * (T264), or null when it holds no skill by that name, or holds one whose folder is missing.
     */
    invokeSkill?(employeeId: string, name: string, prompt: string): string | null
  } | null
  /** The current Company's database; throws when none is open. */
  current(): DatabaseSync
  sessions: Sessions
  log(line: string): void
}

/** The inbox's migration step, appended to the engine's migrations. */
export const INBOX_MIGRATION: Migration = {
  name: 'inbox-table',
  sql: `
  CREATE TABLE inbox_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL REFERENCES employee (id),
    kind TEXT NOT NULL,
    from_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_id INTEGER,
    message_id INTEGER NOT NULL REFERENCES message (id),
    text TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    handled_at TEXT
  );
  CREATE INDEX inbox_item_by_employee ON inbox_item (employee_id, status, id);
`,
}

/** An inbox item that is not filed from a chat message. */
export type NewInboxItem = Pick<
  InboxItem,
  'employeeId' | 'kind' | 'fromId' | 'channelId' | 'threadId' | 'messageId' | 'ticketId' | 'text' | 'prompt'
>

/** An inbox item about one message, with its own prompt. */
export interface MessageInboxItem {
  employeeId: string
  kind: WakeKind
  message: Message
  prompt: string
}

/** What the board and the answerer chain say about a message. */
export interface WakeContext {
  /** The holder of each referenced ticket that is held and not done, by ticket id. */
  holders: Map<number, string>
  /** The members of the epic channel the message is in, or null outside an epic channel. */
  epicMembers: string[] | null
  /** The intake holder, told how to turn a boss goal into a target when the boss addresses them. */
  intakeId?: string | null
  /**
   * Who answers a boss message that addresses nobody (decision 41): the first available Employee
   * of the answerer chain, else the one the message waits for. Null with no Employees.
   */
  answererId?: string | null
  /** For a thread reply: the author of the message it answers (see `repliedTo`). */
  repliedToId?: string | null
  /** For a thread reply: the Employee who answers the boss in that thread, kept when the setting changes. */
  threadAnswererId?: string | null
  /** The Employee this reply must not wake as `thread`, because a more specific item is filed for them. */
  quietedId?: string | null
}

export interface WakeTarget {
  kind: WakeKind
  /** The ticket of theirs that was referenced, for `ticket`. */
  ticketId: number | null
  /** Filed unread for them to see, never pushed: an unaddressed message someone else answers. */
  unread?: boolean
}

/**
 * Who `message` wakes and why, one kind per Employee, the most specific one (decision 41): a DM its
 * recipient; `@name` the named; `@channel` everyone; a ticket reference its holder; a thread reply the
 * author of the message it answers; an unaddressed boss message only the answerer. Everyone else in
 * `#general`, or in the epic channel, gets a top-level message unread.
 */
export function wakeTargets(
  message: Message,
  people: Mentionable[],
  context: WakeContext = { holders: new Map(), epicMembers: null },
): Map<string, WakeTarget> {
  const targets = new Map<string, WakeTarget>()
  // The daily digest is the app talking to the boss (T172): it is not a chat post from an Employee,
  // so it wakes nobody and enters nobody's inbox, however many tickets it happens to name.
  if (message.kind === 'digest') return targets
  const known = new Set(people.map((p) => p.id))
  const add = (id: string, kind: WakeKind, ticketId: number | null = null, unread = false) => {
    if (id !== message.authorId && known.has(id) && !targets.has(id)) {
      targets.set(id, unread ? { kind, ticketId, unread } : { kind, ticketId })
    }
  }
  const members = dmMembers(message.channelId)
  if (members) {
    for (const id of members) add(id, 'dm')
    return targets
  }
  const fromBoss = message.authorId === BOSS
  for (const id of message.mentions) add(id, 'mention')
  if (message.mentionsChannel) for (const id of context.epicMembers ?? known) add(id, 'channel')
  for (const [ticketId, holder] of context.holders) add(holder, 'ticket', ticketId)

  if (message.threadId !== null) {
    const answered = context.repliedToId
    if (answered !== null && answered === context.quietedId) return targets
    if (answered && known.has(answered)) add(answered, 'thread')
    else if (fromBoss && targets.size === 0) {
      const answerer = context.threadAnswererId ?? context.answererId
      if (answerer) add(answerer, 'thread')
    }
    return targets
  }

  if (!fromBoss) for (const id of context.epicMembers ?? []) add(id, 'epic')
  if (fromBoss && targets.size === 0 && context.answererId) add(context.answererId, 'intake')
  // Everyone else in the channel gets it unread: every Employee in #general, the members of an epic
  // channel, and, for a boss message, everyone in any other named channel.
  const readers = context.epicMembers ?? (isGeneralPost(message) || fromBoss ? known : [])
  for (const id of readers) add(id, context.epicMembers ? 'epic' : 'general', null, true)
  return targets
}

const KIND_LABEL: Record<WakeKind, string> = {
  dm: 'DM',
  mention: 'mention',
  ticket: 'reference to your ticket',
  channel: '@channel',
  epic: 'message in your epic channel',
  approval: 'approval decision',
  assigned: 'assignment',
  intake: 'message for you to answer',
  resume: 'restart',
  review: 'review',
  general: 'message someone else answers',
  thread: 'reply in your thread',
  session: 'Session you started',
  planning: 'something to plan',
  testing: 'something to test',
  unblocked: 'ticket that no longer waits',
  deleted: 'ticket the boss deleted',
}

/** What the intake holder is asked to do with a boss message. */
const INTAKE_HINT =
  'You hold intake: if this is a goal, turn it into a target (target_create), epics (epic_create) and ' +
  'tickets (ticket_create), each assigned to an engineer whose repos it touches — and when one ticket needs another ' +
  'done first, record it with ticket_blocked_by — then answer with chat_post ' +
  'passing target_id. If it is not a goal, create nothing and just answer.'

/** What the answerer of an unaddressed boss message is told (decision 41). */
export const ANSWERER_HINT =
  'You answer the boss: nobody else was woken for this, so the reply is yours; @mention a teammate if you need one.'

/**
 * `[company] <kind> from <who> in <where>: "<text>"`, then `hint`, the voice to write in, then how
 * to reply through MCP. The text is JSON-quoted so the prompt stays on one line.
 */
export function inboxPrompt(
  companyKey: string,
  { kind, ticketId }: WakeTarget,
  message: Message,
  fromName: string,
  hint = '',
  voice: ColleagueVoice = DEFAULT_COLLEAGUE_VOICE,
): string {
  const label =
    kind === 'ticket' && ticketId !== null
      ? `${KIND_LABEL.ticket} ${ticketCode(companyKey, ticketId)}`
      : KIND_LABEL[kind]
  const channel = dmMembers(message.channelId) ? `@${fromName}` : `#${message.channelId}`
  const where = message.threadId === null ? channel : `${channel}, thread ${message.threadId}`
  // A DM is one conversation, so the answer goes in the DM, and a thread there is only where the
  // boss took it (T269): offered either, Employees answered DMs in threads nobody opens. Anywhere
  // else the answer goes under the message, in its thread, so a channel reads as one line per topic
  // however many answer it.
  const reply =
    message.threadId !== null
      ? `thread_reply to message ${message.threadId}`
      : dmMembers(message.channelId)
        ? `chat_post to "${channel}", never a thread_reply in a DM`
        : `thread_reply to message ${message.id}, never a new chat_post in "${channel}"`
  return (
    `[company] ${label} from ${fromName} in ${where}: ${JSON.stringify(message.text)} ` +
    `(message ${message.id}) ${hint ? `${hint} ` : ''}${voiceHint(message.channelId, voice)} ` +
    `Reply through the company MCP server: ${reply}. Never answer in plain text.`
  )
}

/** The hints for `employeeId` about a boss message: the intake instruction, and the answerer's. */
export function bossHints(employeeId: string, kind: WakeKind, context: WakeContext, note = ''): string {
  const hints: string[] = []
  if (kind === 'intake') hints.push(note ? `${ANSWERER_HINT} ${note}` : ANSWERER_HINT)
  if (employeeId === context.intakeId) hints.push(INTAKE_HINT)
  return hints.join(' ')
}

/**
 * The prompt of a boss message that opens with `/<skill>`, sent to one Employee who holds that
 * skill: the same prompt, invoked the way the Employee's Provider invokes a skill (T264). Only a DM
 * and a mention are addressed to that one Employee — a skill is never run for a reader of a channel.
 */
function skillPrompt(
  open: { invokeSkill?(employeeId: string, name: string, prompt: string): string | null },
  employeeId: string,
  target: WakeTarget,
  message: Message,
  prompt: string,
): string {
  if (message.authorId !== BOSS || (target.kind !== 'dm' && target.kind !== 'mention')) return prompt
  const name = slashAttempt(message.text)
  return (name !== null && open.invokeSkill?.(employeeId, name, prompt)) || prompt
}

interface Delivery {
  companyId: string
  itemId: number
  tries: number
  timer: ReturnType<typeof setTimeout>
}

export function createInbox({ company, current, sessions, log }: InboxOptions): InboxService {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  /** The push waiting for its UserPromptSubmit, per Employee. */
  const inFlight = new Map<string, Delivery>()
  /** Employees whose retried push went unanswered: no pushes until their next idle signal. */
  const paused = new Set<string>()

  function file(db: DatabaseSync, item: NewInboxItem, createdAt: string): number {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO inbox_item
         (employee_id, kind, from_id, channel_id, thread_id, message_id, ticket_id, text, prompt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.employeeId,
        item.kind,
        item.fromId,
        item.channelId,
        item.threadId,
        item.messageId,
        item.ticketId,
        item.text,
        item.prompt,
        createdAt,
      )
    return Number(lastInsertRowid)
  }

  /** Files `message` unread for `employeeId`: listed in their inbox, never pushed (decision 41). */
  function fileUnread(db: DatabaseSync, employeeId: string, target: WakeTarget, message: Message, fromName: string) {
    const itemId = file(
      db,
      {
        employeeId,
        kind: target.kind,
        fromId: message.authorId,
        channelId: message.channelId,
        threadId: null,
        messageId: message.id,
        ticketId: null,
        text: message.text,
        prompt: generalPrompt([{ message, fromName }], message.channelId),
      },
      message.createdAt,
    )
    db.prepare(`UPDATE inbox_item SET status = 'unread' WHERE id = ?`).run(itemId)
  }

  /**
   * Files a thread reply for `employeeId`, folded into their `thread` item for the same thread that
   * was never pushed, if any; the prompt quotes the root and the replies before the folded ones.
   */
  function fileThread(db: DatabaseSync, employeeId: string, message: Message, people: Mentionable[]): void {
    const threadId = message.threadId!
    const open = db
      .prepare(
        `SELECT id FROM inbox_item WHERE employee_id = ? AND kind = 'thread' AND thread_id = ?
         AND status = 'pending' AND attempts = 0 ORDER BY id LIMIT 1`,
      )
      .get(employeeId, threadId) as { id: number } | undefined
    const itemId =
      open?.id ??
      file(
        db,
        {
          employeeId,
          kind: 'thread',
          fromId: message.authorId,
          channelId: message.channelId,
          threadId,
          messageId: message.id,
          ticketId: null,
          text: message.text,
          prompt: '',
        },
        message.createdAt,
      )
    db.prepare('INSERT INTO inbox_item_message (item_id, message_id) VALUES (?, ?)').run(itemId, message.id)
    const folded = (
      db.prepare('SELECT message_id AS id FROM inbox_item_message WHERE item_id = ?').all(itemId) as unknown as {
        id: number
      }[]
    ).map((r) => r.id)
    const context = threadContext(db, threadId, folded)
    db.prepare('UPDATE inbox_item SET text = ?, prompt = ? WHERE id = ?').run(
      context.fresh.map((m) => m.text).join('\n'),
      threadPrompt(
        message.channelId,
        threadId,
        context,
        (id) => nameOf(id, people),
        null,
        createVoiceSettings(db).colleagueVoice(),
      ),
      itemId,
    )
  }

  function nameOf(id: string, people: Mentionable[]): string {
    return id === BOSS ? BOSS : (people.find((p) => p.id === id)?.name ?? 'former employee')
  }

  function drain(companyId: string, employeeId: string): void {
    if (inFlight.has(employeeId) || paused.has(employeeId)) return
    const db = company(companyId)?.db
    const next = db
      ?.prepare(
        `SELECT id, prompt FROM inbox_item WHERE employee_id = ? AND status = 'pending'
         ORDER BY kind = 'resume' DESC, id LIMIT 1`,
      )
      .get(employeeId) as { id: number; prompt: string } | undefined
    if (!db || !next) return
    push(companyId, employeeId, next, 1)
  }

  function push(companyId: string, employeeId: string, item: { id: number; prompt: string }, tries: number) {
    const db = company(companyId)?.db
    if (!db || !sessions.pushPrompt(employeeId, item.prompt)) return
    db.prepare('UPDATE inbox_item SET attempts = attempts + 1 WHERE id = ?').run(item.id)
    const timer = setTimeout(() => unanswered(companyId, employeeId, item), PUSH_CONFIRM_TIMEOUT_MS)
    inFlight.set(employeeId, { companyId, itemId: item.id, tries, timer })
    notify()
  }

  function unanswered(companyId: string, employeeId: string, item: { id: number; prompt: string }) {
    const delivery = inFlight.get(employeeId)
    if (delivery?.itemId !== item.id) return
    inFlight.delete(employeeId)
    const who = nameOf(employeeId, company(companyId)?.people ?? [])
    const seconds = PUSH_CONFIRM_TIMEOUT_MS / 1000
    if (delivery.tries === 1) {
      log(`Inbox: ${who} sent no UserPromptSubmit ${seconds} s after a push of item ${item.id}; retrying once`)
      push(companyId, employeeId, item, 2)
    } else {
      log(
        `Inbox: ${who} sent no UserPromptSubmit again for item ${item.id}; ` +
          'holding the inbox until the Session is idle again',
      )
      paused.add(employeeId)
    }
  }

  function forget(employeeId: string): void {
    clearTimeout(inFlight.get(employeeId)?.timer)
    inFlight.delete(employeeId)
    paused.delete(employeeId)
  }

  function onActivity({ companyId, employeeId, status, hook, signal }: SessionActivity): void {
    if (status === 'off') return void forget(employeeId)
    const delivery = inFlight.get(employeeId)
    if (hook === 'UserPromptSubmit' && delivery) {
      clearTimeout(delivery.timer)
      inFlight.delete(employeeId)
      company(delivery.companyId)
        ?.db.prepare(`UPDATE inbox_item SET status = 'handled', handled_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), delivery.itemId)
      notify()
    }
    if (hook && signal === 'idle') paused.delete(employeeId)
    if (status === 'idle') drain(companyId, employeeId)
  }
  const stopActivity = sessions.onActivity(onActivity)

  return {
    list(employeeId) {
      const rows = current()
        .prepare('SELECT * FROM inbox_item WHERE employee_id = ? ORDER BY id')
        .all(employeeId) as unknown as InboxRow[]
      return rows.map(toItem)
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    wake(companyId, message) {
      const open = company(companyId)
      if (!open) return
      const context: WakeContext = {
        ...(open.context?.(message) ?? { holders: new Map(), epicMembers: null }),
        repliedToId: repliedTo(open.db, message),
        quietedId: quietedIn(open.db, message.threadId),
      }
      const targets = wakeTargets(message, open.people, context)
      if (targets.size === 0) return
      const fromName = nameOf(message.authorId, open.people)
      for (const [employeeId, target] of targets) {
        if (target.unread) {
          fileUnread(open.db, employeeId, target, message, fromName)
          continue
        }
        if (target.kind === 'thread') {
          fileThread(open.db, employeeId, message, open.people)
          continue
        }
        const note = target.kind === 'intake' ? (open.answered?.(message, employeeId) ?? '') : ''
        const prompt = inboxPrompt(
          companyKeyOf(open.db),
          target,
          message,
          fromName,
          message.authorId === BOSS ? bossHints(employeeId, target.kind, context, note) : '',
          createVoiceSettings(open.db).colleagueVoice(),
        )
        file(
          open.db,
          {
            employeeId,
            kind: target.kind,
            fromId: message.authorId,
            channelId: message.channelId,
            threadId: message.threadId,
            messageId: message.id,
            ticketId: target.ticketId,
            text: message.text,
            prompt: skillPrompt(open, employeeId, target, message, prompt),
          },
          message.createdAt,
        )
      }
      notify()
      for (const [employeeId, target] of targets) if (!target.unread) drain(companyId, employeeId)
    },

    deliver(companyId, input) {
      const open = company(companyId)
      if (!open?.people.some((p) => p.id === input.employeeId)) return
      const item: NewInboxItem =
        'message' in input
          ? {
              employeeId: input.employeeId,
              kind: input.kind,
              fromId: input.message.authorId,
              channelId: input.message.channelId,
              threadId: input.message.threadId,
              messageId: input.message.id,
              ticketId: null,
              text: input.message.text,
              prompt: input.prompt,
            }
          : input
      file(open.db, item, 'message' in input ? input.message.createdAt : new Date().toISOString())
      notify()
      drain(companyId, item.employeeId)
    },

    close() {
      stopActivity()
      for (const employeeId of [...inFlight.keys()]) forget(employeeId)
      paused.clear()
      listeners.clear()
    },
  }
}

interface InboxRow {
  id: number
  employee_id: string
  kind: WakeKind
  from_id: string
  channel_id: string | null
  thread_id: number | null
  message_id: number | null
  ticket_id: number | null
  text: string
  prompt: string
  status: InboxStatus
  attempts: number
  created_at: string
  handled_at: string | null
}

function toItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind,
    fromId: row.from_id,
    channelId: row.channel_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    ticketId: row.ticket_id,
    text: row.text,
    prompt: row.prompt,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  }
}
