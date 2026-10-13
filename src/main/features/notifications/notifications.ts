import type { DatabaseSync } from 'node:sqlite'
import { ACTION_LABEL, type Approval } from '../../../shared/approvals'
import { BOSS, COMPANY_AUTHOR, dmMembers, type Mentionable, type Message } from '../../../shared/domain/chat'
import { askingText } from '../../../shared/inbox/boss-inbox'
import type { CompanyNotification, NotificationAction, NotificationDelivery } from '../../../shared/notifications'
import { type DailyDigest, digestNotificationTitle, digestSummary } from '../../../shared/planning/daily-digest'
import { type Plan, waitsOnBoss } from '../../../shared/planning/planning'
import { clockTime } from '../../../shared/platform/clock-time'
import type { SessionAsk } from '../../../shared/session'
import type { Migration } from '../../core'

/** The notifications' migration step, appended to the engine's migrations. */
export const NOTIFICATIONS_MIGRATION: Migration = {
  name: 'notifications-setting',
  sql: `
  CREATE TABLE notification_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL
  );
`,
}

/** Longest notification body, in characters. */
export const MAX_BODY = 200

/**
 * What a notification listener answers with. The one that posts native banners says what the system
 * did with it; listeners that only watch answer nothing (T126).
 */
export type NotifyListener = (
  notification: CompanyNotification,
) => void | NotificationDelivery | Promise<NotificationDelivery | void>

/** The current Company's notification toggle, and the notifications of every open Company. */
export interface Notifications {
  /** Whether the current Company notifies. On until the boss turns it off. */
  enabled(): boolean
  setEnabled(enabled: boolean): boolean
  /** Called with every notification of a Company that has them on. Returns an unsubscribe function. */
  onNotify(listener: NotifyListener): () => void
  /**
   * Posts the current Company's test banner down the same path every other notification takes, and
   * resolves with what the system did: the one answer that tells the boss whether the silence is
   * the app's or the system's (T126).
   */
  sendTest(): Promise<NotificationDelivery>
}

/** A PR the Company opened, and the message that announced it. */
export interface OpenedPullRequest {
  ticketId: number
  title: string
  assigneeId: string | null
  repo: string
  /** The PR's number on the host, or null when its URL named none. */
  number?: number | null
  message: Message
}

/** The banner Send a test notification posts: it says, on its face, that it is a test. */
export const TEST_NOTIFICATION = {
  title: 'Test notification',
  body: 'This is a test. Notifications from this Company reach you.',
}

/** Reject and Approve, in the design's order. */
export const APPROVAL_ACTIONS: NotificationAction[] = [
  { id: 'reject', label: 'Reject' },
  { id: 'approve', label: 'Approve' },
]

/** Later and Open digest, in the design's order (frame `b9EZF`). */
export const DIGEST_ACTIONS: NotificationAction[] = [
  { id: 'later', label: 'Later' },
  { id: 'open', label: 'Open digest' },
]

/** The digest that just went up, and the message carrying it. */
export interface PostedDigest {
  messageId: number
  channelId: string
  digest: DailyDigest
  companyName: string
}

/** The engine's side: the events that notify. */
export interface NotificationService extends Notifications {
  /** Every chat message of an open Company, as it is posted. */
  messagePosted(companyId: string, message: Message): void
  pullRequestOpened(companyId: string, opened: OpenedPullRequest): void
  /** The budget ran out; `posts` are the `#general` messages that said so, one per Company. */
  budgetExhausted(posts: { companyId: string; message: Message }[], resetsAt?: Date | null): void
  /**
   * A Session stopped in its terminal to ask the boss (T165). Called once per ask, so a Provider
   * that repeats its permission hook rings once; clicking the banner opens that Employee's drawer,
   * which opens on the Terminal tab, because the terminal is where the boss answers.
   */
  asking(companyId: string, asked: { employeeId: string; ask: SessionAsk }): void
  /**
   * The daily digest was posted (T172). It rings only when the Company's own notifications are on,
   * like everything else here; clicking it opens the channel at the digest.
   */
  digestPosted(companyId: string, posted: PostedDigest): void
  close(): void
}

export interface NotificationsOptions {
  /** The current Company's database; throws when none is open. */
  current(): DatabaseSync
  /** The current Company's id; throws when none is open. */
  currentId(): string
  /** An open Company's name, database, people, pending Approvals, plans and threads, or null. */
  company(companyId: string): {
    name: string
    db: DatabaseSync
    people(): Mentionable[]
    pendingApprovals(): Approval[]
    /** Every plan of that Company, newest version per subject; a plan waiting on the boss rings. */
    plans(): Plan[]
    /** Who started the thread rooted at `threadId` and who is named anywhere in it (T231). */
    thread(threadId: number): { authorId: string; mentioned: string[] } | null
  } | null
}

export function createNotifications({ current, currentId, company }: NotificationsOptions): NotificationService {
  const listeners = new Set<NotifyListener>()

  function enabledIn(db: DatabaseSync): boolean {
    const row = db.prepare('SELECT enabled FROM notification_setting WHERE id = 1').get() as
      | { enabled: number }
      | undefined
    return row ? row.enabled === 1 : true
  }

  /**
   * Hands a notification to every listener and resolves with what became of it. Callers that only
   * want the boss told ignore the promise; Send a test notification is the one that reads it.
   */
  async function send(notification: CompanyNotification): Promise<NotificationDelivery> {
    const found = company(notification.companyId)
    if (!found?.db.isOpen || !enabledIn(found.db)) return { status: 'off' }
    const sent = { ...notification, body: shorten(notification.body) }
    const answers = await Promise.all([...listeners].map((listener) => listener(sent)))
    // Nothing that posts banners is listening — in a window-less run, or before the app is ready.
    return answers.find((answer): answer is NotificationDelivery => !!answer) ?? { status: 'unsupported' }
  }

  function nameOf(people: Mentionable[], id: string): string {
    return people.find((p) => p.id === id)?.name ?? 'An Employee'
  }

  /** Runs once the action that posted `message` is done, so an Approval it opens can be told apart. */
  function mentionOrApproval(companyId: string, message: Message): void {
    const found = company(companyId)
    if (!found?.db.isOpen) return
    const people = found.people()
    const who = nameOf(people, message.authorId)
    // A drafted plan is a decision the boss owns: it rings as one, not as chatter that named them.
    // Before T233 it was a plain mention, and the boss simply never heard that the plan had landed.
    const plan = found.plans().find((one) => one.messageId === message.id && waitsOnBoss(one))
    if (plan) {
      void send({
        companyId,
        kind: 'plan',
        title: plan.status === 'replan' ? 'Replan waiting on you' : 'Plan ready to approve',
        body: `${who} — ${flat(message.text)}`,
        icon: initials(who),
        focus: {
          kind: 'thread',
          channelId: plan.channelId,
          threadId: plan.threadId ?? message.id,
          messageId: message.id,
        },
      })
      return
    }
    const approval = found.pendingApprovals().find((a) => a.messageId === message.id)
    if (approval) {
      void send({
        companyId,
        kind: 'approval',
        title: 'Approval requested',
        body: `${who} wants to ${ACTION_LABEL[approval.action]} ${approval.subject}`,
        icon: initials(who),
        focus: {
          kind: 'thread',
          channelId: approval.channelId,
          threadId: approval.messageId,
          messageId: approval.messageId,
        },
        actions: APPROVAL_ACTIONS,
        approvalId: approval.id,
      })
      return
    }
    const dm = dmMembers(message.channelId)
    const direct = !!dm?.includes(BOSS)
    const named = direct || message.mentions.includes(BOSS)
    // A reply reaches the boss even when it names nobody, when it is in a thread they started or
    // were pulled into (T231). Asked only of a message that names nobody, so one message is still
    // one notification however many of the three rules it answers to.
    const thread = named || message.threadId === null ? null : found.thread(message.threadId)
    const started = thread?.authorId === BOSS
    const following = started || !!thread?.mentioned.includes(BOSS)
    if (!named && !following) return
    void send({
      companyId,
      kind: 'mention',
      title: direct
        ? `${who} sent you a message`
        : following
          ? `${who} replied in ${started ? 'your thread' : 'a thread you’re in'}`
          : `${who} mentioned you`,
      body: direct ? `“${flat(message.text)}”` : `#${message.channelId} — “${flat(message.text)}”`,
      icon: initials(who),
      focus: { kind: 'thread', channelId: message.channelId, threadId: message.threadId, messageId: message.id },
    })
  }

  return {
    enabled: () => enabledIn(current()),

    setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Notifications are either on or off')
      current()
        .prepare(
          `INSERT INTO notification_setting (id, enabled) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled`,
        )
        .run(enabled ? 1 : 0)
      return enabled
    },

    onNotify(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    sendTest() {
      const companyId = currentId()
      const found = company(companyId)
      if (!found?.db.isOpen) throw new Error('No Company is open')
      return send({
        companyId,
        kind: 'test',
        title: TEST_NOTIFICATION.title,
        body: TEST_NOTIFICATION.body,
        icon: initials(found.name),
        focus: { kind: 'thread', channelId: 'general', threadId: null },
      })
    },

    messagePosted(companyId, message) {
      if (message.authorId === BOSS || message.authorId === COMPANY_AUTHOR) return
      queueMicrotask(() => mentionOrApproval(companyId, message))
    },

    pullRequestOpened(companyId, { title, assigneeId, repo, number = null, message }) {
      const found = company(companyId)
      if (!found) return
      const opener = assigneeId && found.db.isOpen ? found.people().find((p) => p.id === assigneeId)?.name : undefined
      void send({
        companyId,
        kind: 'pull_request',
        title: 'Pull request opened',
        body: pullRequestBody({ opener: opener ?? 'The team', repo, number, title }),
        icon: initials(opener ?? found.name),
        focus: assigneeId
          ? { kind: 'employee', employeeId: assigneeId }
          : { kind: 'thread', channelId: message.channelId, threadId: null, messageId: message.id },
      })
    },

    asking(companyId, { employeeId, ask }) {
      const found = company(companyId)
      if (!found?.db.isOpen) return
      const who = nameOf(found.people(), employeeId)
      void send({
        companyId,
        kind: 'asking',
        title: `${who} is asking you`,
        // The same sentence the Inbox row carries, so the two never say different things.
        body: askingText(who, ask),
        icon: initials(who),
        focus: { kind: 'employee', employeeId },
      })
    },

    digestPosted(companyId, { messageId, channelId, digest, companyName }) {
      const found = company(companyId)
      if (!found?.db.isOpen) return
      void send({
        companyId,
        kind: 'digest',
        title: digestNotificationTitle(companyName),
        body: digestSummary(digest),
        icon: initials(companyName),
        focus: { kind: 'digest', channelId, messageId },
        actions: DIGEST_ACTIONS,
      })
    },

    budgetExhausted(posts, resetsAt = null) {
      const post = posts.find(({ companyId }) => {
        const db = company(companyId)?.db
        return db?.isOpen && enabledIn(db)
      })
      const found = post && company(post.companyId)
      if (!post || !found) return
      void send({
        companyId: post.companyId,
        kind: 'budget',
        title: 'Budget exhausted',
        body: budgetBody(resetsAt, new Date()),
        icon: '!',
        focus: { kind: 'thread', channelId: post.message.channelId, threadId: null, messageId: post.message.id },
      })
    },

    close() {
      listeners.clear()
    },
  }
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shorten(text: string): string {
  const line = flat(text)
  return line.length <= MAX_BODY ? line : `${line.slice(0, MAX_BODY - 1).trimEnd()}…`
}

/** "Vega opened web-app #131 · Currency + locale formatting helper." without the full stop. */
export function pullRequestBody(pr: { opener: string; repo: string; number: number | null; title: string }): string {
  const where = pr.number === null ? `a PR in ${pr.repo}` : `${pr.repo} #${pr.number}`
  return `${pr.opener} opened ${where} · ${pr.title}`
}

/** The budget notification's body: when the team is back from the coffee area. */
export function budgetBody(resetsAt: Date | null, now: Date): string {
  const until = resetsAt ? clockTime(resetsAt, now) : 'the limit resets'
  return `The subscription limit is reached. The team is in the coffee area until ${until}.`
}

/** Two letters for the notification icon: "Tiny Corp" → TC, "Nova" → NV (first letter and next consonant). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  const [first, ...rest] = [...words[0]!]
  const second = rest.find((c) => /[^aeiou\W\d_]/i.test(c)) ?? rest[0] ?? ''
  return (first! + second).toUpperCase()
}
