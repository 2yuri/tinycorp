import type { DatabaseSync } from 'node:sqlite'
import {
  ACTION_LABEL,
  type Approval,
  type ApprovalDecision,
  type ApprovalInput,
  type ApprovalOutcome,
  type ApprovalStatus,
  type AutonomyLevel,
  DEFAULT_AUTONOMY,
  type Gate,
  type GateConditions,
  type GatedAction,
  gate,
  isAutonomyLevel,
  isGatedAction,
} from '../../../shared/approvals'
import { approvalSentence } from '../../../shared/approvals/approval-summary'
import { BOSS, type Message } from '../../../shared/domain/chat'
import type { WakeKind } from '../../../shared/inbox'
import type { Migration } from '../../core'
import type { Chat } from '../chat'
import { withoutThreadWake } from '../sessions'
import { approvalAbout } from './approval-subject'

/** Where approval threads are posted: the boss's desk channel, which everyone reads (decision 30). */
export const APPROVAL_CHANNEL = 'general'

/** One Company's autonomy level and Approvals. */
export interface CompanyApprovals {
  level(): AutonomyLevel
  setLevel(level: AutonomyLevel): AutonomyLevel
  /** Whether `action` is free or needs an Approval under the current level. */
  gate(action: GatedAction, conditions?: GateConditions): Gate
  /**
   * Asks for `action`. When the gate says `ask`, creates a pending Approval and its chat thread;
   * the requester must wait for the decision, which arrives in its inbox.
   */
  request(input: ApprovalInput): ApprovalOutcome
  /** The boss approves or rejects. Rejecting needs a reason, which is sent to the requester. */
  decide(id: number, decision: ApprovalDecision): Approval
  /** Approvals, oldest first. */
  list(filter?: { status?: ApprovalStatus }): Approval[]
  /**
   * True when `employeeId` may do `action` on `about` now: it is free, or the boss approved it.
   * `about` is a subject in words, or the ticket the Approval named.
   */
  granted(
    employeeId: string,
    action: GatedAction,
    about: string | { ticketId: number },
    conditions?: GateConditions,
  ): boolean
}

/** The engine's view: the current Company's approvals, plus change and decision events from any open Company. */
export interface Approvals extends CompanyApprovals {
  /** Called after the level or any Approval changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
  /** Called after the boss decides an Approval, e.g. to carry out an approved hire. */
  onDecision(listener: (approval: Approval, companyId: string) => void): () => void
}

/** The approvals' migration step, appended to the engine's migrations. */
export const APPROVALS_MIGRATION: Migration = {
  name: 'approvals-tables',
  sql: `
  CREATE TABLE autonomy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    level TEXT NOT NULL
  );
  CREATE TABLE approval (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    requester_id TEXT NOT NULL REFERENCES employee (id),
    subject TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decision_reason TEXT,
    channel_id TEXT NOT NULL,
    message_id INTEGER NOT NULL REFERENCES message (id),
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX approval_by_status ON approval (status, id);
`,
}

export interface CompanyApprovalsOptions {
  db: DatabaseSync
  chat: Chat
  /** Files an inbox item for the requester, as `InboxService.deliver` does. */
  deliver(item: { employeeId: string; kind: WakeKind; message: Message; prompt: string }): void
  onChange(): void
  onDecision(approval: Approval): void
  /**
   * Why the ticket's repos refuse a merge, or null when they allow it (decision 61). A merge the
   * repo forbids is refused here, so the boss is never asked for it under any autonomy level.
   */
  mergeRefusal?(ticketId: number): string | null
}

export function createCompanyApprovals({
  db,
  chat,
  deliver,
  onChange,
  onDecision,
  mergeRefusal,
}: CompanyApprovalsOptions): CompanyApprovals {
  function level(): AutonomyLevel {
    const row = db.prepare('SELECT level FROM autonomy WHERE id = 1').get() as { level: string } | undefined
    return row && isAutonomyLevel(row.level) ? row.level : DEFAULT_AUTONOMY
  }

  function requireAction(action: unknown): GatedAction {
    if (!isGatedAction(action)) throw new Error(`Unknown action: ${String(action)}`)
    return action
  }

  function find(id: number): Approval | undefined {
    const row = db.prepare('SELECT * FROM approval WHERE id = ?').get(id) as ApprovalRow | undefined
    return row && toApproval(row)
  }

  const approvals: CompanyApprovals = {
    level,

    setLevel(next) {
      if (!isAutonomyLevel(next)) throw new Error(`Unknown autonomy level: ${String(next)}`)
      db.prepare(
        'INSERT INTO autonomy (id, level) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET level = excluded.level',
      ).run(next)
      onChange()
      return next
    },

    gate(action, conditions) {
      return gate(level(), requireAction(action), conditions)
    },

    request(input) {
      const { requesterId, action, reason = '', conditions } = input
      requireAction(action)
      if (requesterId === BOSS || !db.prepare('SELECT 1 FROM employee WHERE id = ?').get(requesterId)) {
        throw new Error(`Unknown Employee: ${requesterId}`)
      }
      const about = approvalAbout(db, input)
      const what = about.subject
      const why = typeof reason === 'string' ? reason.trim() : ''
      // The repo is asked before the autonomy level is: what it forbids, no level allows.
      if (action === 'merge' && about.ticketId !== null) {
        const refusal = mergeRefusal?.(about.ticketId)
        if (refusal) throw new Error(refusal)
      }
      const current = level()
      if (gate(current, action, conditions) === 'free') return { gate: 'free', level: current }

      // One human sentence; the facts live on the card, and the boss is a mention, not text (decision 42).
      const root = chat.post({
        authorId: requesterId,
        channelId: APPROVAL_CHANNEL,
        text: approvalSentence(action, what, input.summary),
        mentions: [BOSS],
      })
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO approval (action, requester_id, subject, ticket_id, pr_repo_id, pr_number, reason,
             channel_id, message_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          action,
          requesterId,
          what,
          about.ticketId,
          about.pullRequest?.repoId ?? null,
          about.pullRequest?.number ?? null,
          why,
          root.channelId,
          root.id,
          root.createdAt,
        )
      onChange()
      return { gate: 'ask', level: current, approval: find(Number(lastInsertRowid))! }
    },

    decide(id, { approve, reason }) {
      const approval = find(id)
      if (!approval) throw new Error(`There is no approval ${id}`)
      if (approval.status !== 'pending') throw new Error(`Approval ${id} is already ${approval.status}`)
      const why = typeof reason === 'string' ? reason.trim() : ''
      if (!approve && !why) throw new Error('Rejecting needs a reason')

      const reply = withoutThreadWake(db, approval.messageId, approval.requesterId, () =>
        chat.reply({
          authorId: BOSS,
          messageId: approval.messageId,
          text: approve ? `Approved.${why ? ` ${why}` : ''}` : `Rejected: ${why}`,
        }),
      )
      db.prepare(`UPDATE approval SET status = ?, decision_reason = ?, decided_at = ? WHERE id = ?`).run(
        approve ? 'approved' : 'rejected',
        why || null,
        reply.createdAt,
        id,
      )
      const decided = find(id)!
      deliver({ employeeId: decided.requesterId, kind: 'approval', message: reply, prompt: decisionPrompt(decided) })
      onChange()
      onDecision(decided)
      return decided
    },

    list({ status } = {}) {
      const rows = (status
        ? db.prepare('SELECT * FROM approval WHERE status = ? ORDER BY id').all(status)
        : db.prepare('SELECT * FROM approval ORDER BY id').all()) as unknown as ApprovalRow[]
      return rows.map(toApproval)
    },

    granted(employeeId, action, about, conditions) {
      if (approvals.gate(action, conditions) === 'free') return true
      const [column, value] =
        typeof about === 'object' ? ['ticket_id', about.ticketId] : ['subject', String(about).trim()]
      return !!db
        .prepare(
          `SELECT 1 FROM approval
           WHERE requester_id = ? AND action = ? AND ${column} = ? AND status = 'approved'`,
        )
        .get(employeeId, action, value)
    },
  }
  return approvals
}

/** What an Employee is told instead of "Go ahead" about a merge: the app does it (decision 44). */
export const APP_MERGES = 'The app merges it and moves the ticket to Done; never merge with git yourself.'

/** What the requester is told when the boss decides. */
export function decisionPrompt(approval: Approval): string {
  const where = `#${approval.channelId}, thread ${approval.messageId}`
  const asked = `your request to ${ACTION_LABEL[approval.action]} (${approval.subject})`
  const outcome =
    approval.status === 'approved'
      ? `APPROVED ${asked}.${approval.decisionReason ? ` Note: ${JSON.stringify(approval.decisionReason)}.` : ''} ` +
        (approval.action === 'merge' ? APP_MERGES : 'Go ahead.')
      : `REJECTED ${asked}. Reason: ${JSON.stringify(approval.decisionReason ?? '')}. ` +
        'Do not do it; adjust, and ask again with approval_request if it still makes sense.'
  return (
    `[company] approval decision from ${BOSS} in ${where}: ${outcome} (approval ${approval.id}) ` +
    `To discuss it, reply through the company MCP server: thread_reply to message ${approval.messageId}. ` +
    'Never answer in plain text.'
  )
}

interface ApprovalRow {
  id: number
  action: GatedAction
  requester_id: string
  subject: string
  ticket_id: number | null
  pr_repo_id: string | null
  pr_number: number | null
  reason: string
  status: ApprovalStatus
  decision_reason: string | null
  channel_id: string
  message_id: number
  created_at: string
  decided_at: string | null
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    action: row.action,
    requesterId: row.requester_id,
    subject: row.subject,
    ticketId: row.ticket_id,
    pullRequest:
      row.pr_repo_id !== null && row.pr_number !== null ? { repoId: row.pr_repo_id, number: row.pr_number } : null,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decision_reason,
    channelId: row.channel_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}
