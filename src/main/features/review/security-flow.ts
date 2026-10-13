import type { DatabaseSync } from 'node:sqlite'
import { ticketSubject } from '../../../shared/approvals/approval-subject'
import { BOSS, COMPANY_AUTHOR, type Mentionable } from '../../../shared/domain/chat'
import type { Review } from '../../../shared/review'
import { threadAnchor } from '../../../shared/review/review-threads'
import {
  blockingFindings,
  DEFAULT_SECURITY_SCOPE,
  holdsTheMerge,
  type RiskClassId,
  riskLine,
  SECURITY_SCOPES,
  SECURITY_SEVERITIES,
  SEVERITY_MEANING,
  type SecurityFinding,
  type SecurityPass,
  type SecurityPassState,
  type SecurityReason,
  type SecurityScope,
  type SecuritySeverity,
  securityReason,
  securityRefusal,
} from '../../../shared/review/security'
import type { Migration } from '../../core'
import { companyKeyOf, ticketCodeIn } from '../../core'
import type { Chat } from '../chat'
import { PRS_CHANNEL } from '../code'
import type { NewInboxItem } from '../inbox'
import type { Routing } from '../staff'
import type { ReviewThreads } from './review-threads'

/**
 * The security pass's migration step (T241): one row per pass, one per finding, and the Company's
 * scope setting. A finding is a review thread with a severity on it, so the thread table stays
 * where it is and nothing about the conversation is duplicated here.
 */
export const SECURITY_PASS_MIGRATION: Migration = {
  name: 'review-security-pass',
  sql: `
  CREATE TABLE security_pass (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    review_id INTEGER NOT NULL REFERENCES review (id),
    reviewer_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    reason_kind TEXT NOT NULL,
    reason_classes TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    overridden_by TEXT,
    override_reason TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX security_pass_by_ticket ON security_pass (ticket_id, id);
  CREATE TABLE security_finding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id INTEGER NOT NULL REFERENCES security_pass (id),
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    fix TEXT NOT NULL,
    thread_id INTEGER NOT NULL REFERENCES review_thread (id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX security_finding_by_ticket ON security_finding (ticket_id, id);
  CREATE TABLE security_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    scope TEXT NOT NULL
  );
`,
}

/** What the Security Employee can do about a pass it is holding. */
export interface EmployeeSecurity {
  /** The pass it is reading, or null when it has none. */
  pass(ticketId: number): SecurityPass | null
  /**
   * Files a finding: a review thread on the line it is about, with the severity and the fix in it.
   * A `high` finding blocks the merge until its thread is resolved or the boss overrides the pass.
   */
  file(input: {
    ticketId: number
    severity: SecuritySeverity
    title: string
    fix: string
    detail?: string
    repo?: string
    file?: string
    line?: number
  }): SecurityFinding
  /** Settles a finding's thread, because the fix is in. */
  resolve(findingId: number): SecurityFinding
  /** Ends the pass. With no high finding open, the merge goes ahead from here. */
  submit(input: { ticketId: number; summary: string }): SecurityPass
}

/** One Company's security passes: the boss's side, the Employee's side, and the merge gate. */
export interface CompanySecurity {
  /** A ticket's latest pass, or null when it has never had one. */
  of(ticketId: number): SecurityPass | null
  /** The latest pass of every ticket that has one. */
  list(): SecurityPass[]
  /**
   * A review round started. Asks for a pass when the Company has a Security Employee and the scope
   * says this change is worth one. Reads the diff, so it finishes after the call returns.
   */
  roundStarted(review: Review): void
  /** Why the merge waits on security, or null when it does not. */
  refusal(ticketId: number): string | null
  /** The boss lets the merge through over an open high finding, on the record. */
  override(ticketId: number, reason: string): SecurityPass
  /** Looks again after something changed elsewhere — a thread the boss resolved from the panel. */
  recheck(ticketId: number): void
  scope(): SecurityScope
  setScope(scope: SecurityScope): SecurityScope
  as(employeeId: string): EmployeeSecurity
}

export interface SecurityFlowOptions {
  db: DatabaseSync
  chat: Chat
  /** Who reads a change for security, and who wrote it. */
  routing: Pick<Routing, 'securityReviewer'>
  /** The findings' threads: a finding is one of these with a severity on it. */
  threads: ReviewThreads
  /** The paths a ticket's change touches, as the forge or `git` names them. */
  paths(ticketId: number): Promise<string[]>
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** The pass stopped holding the merge: whatever was waiting on it may go ahead now. */
  onCleared(ticketId: number): void
  onChange(): void
  log(line: string): void
}

interface PassRow {
  id: number
  ticket_id: number
  review_id: number
  reviewer_id: string
  state: SecurityPassState
  reason_kind: SecurityReason['kind']
  reason_classes: string
  summary: string
  overridden_by: string | null
  override_reason: string
  started_at: string
  finished_at: string | null
}

interface FindingRow {
  id: number
  pass_id: number
  ticket_id: number
  severity: SecuritySeverity
  title: string
  fix: string
  thread_id: number
  created_at: string
}

export function createSecurityFlow({
  db,
  chat,
  routing,
  threads,
  paths,
  deliver,
  onCleared,
  onChange,
  log,
}: SecurityFlowOptions): CompanySecurity {
  const idOf = (ticketId: number) => ticketCodeIn(db, ticketId)

  function ticket(id: number): { id: number; title: string; assignee_id: string | null; labels: string } | undefined {
    return db.prepare('SELECT id, title, assignee_id, labels FROM ticket WHERE id = ?').get(id) as
      | { id: number; title: string; assignee_id: string | null; labels: string }
      | undefined
  }

  function labelsOf(row: { labels: string }): string[] {
    const parsed: unknown = JSON.parse(row.labels || '[]')
    return Array.isArray(parsed) ? parsed.filter((label): label is string => typeof label === 'string') : []
  }

  function nameOf(id: string): string {
    const people: Mentionable[] = chat.people()
    return id === BOSS ? BOSS : (people.find((p) => p.id === id)?.name ?? 'former employee')
  }

  /**
   * A ticket's findings, newest pass or not.
   *
   * The security history of a ticket is cumulative: a high finding filed in round 1 and never
   * answered still blocks the merge in round 3, so every pass of the ticket reads every finding of
   * it. Whether one is settled is the thread's answer, never a copy of it kept here.
   */
  function findingsOf(ticketId: number): SecurityFinding[] {
    const rows = db
      .prepare('SELECT * FROM security_finding WHERE ticket_id = ? ORDER BY id')
      .all(ticketId) as unknown as FindingRow[]
    const open = threads.list(ticketId)
    return rows.map((row) => {
      const thread = open.find((entry) => entry.id === row.thread_id)
      return {
        id: row.id,
        passId: row.pass_id,
        severity: row.severity,
        title: row.title,
        fix: row.fix,
        threadId: row.thread_id,
        where: thread ? threadAnchor(thread) : 'the pull request',
        resolved: thread?.state === 'resolved',
        createdAt: row.created_at,
      }
    })
  }

  function toPass(row: PassRow): SecurityPass {
    const classes: unknown = JSON.parse(row.reason_classes || '[]')
    return {
      id: row.id,
      ticketId: row.ticket_id,
      reviewId: row.review_id,
      reviewerId: row.reviewer_id,
      state: row.state,
      reason: {
        kind: row.reason_kind,
        classes: (Array.isArray(classes) ? classes : []) as RiskClassId[],
      },
      summary: row.summary,
      overriddenBy: row.overridden_by,
      overrideReason: row.override_reason,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      findings: findingsOf(row.ticket_id),
    }
  }

  function latest(ticketId: number): SecurityPass | null {
    const row = db.prepare('SELECT * FROM security_pass WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').get(ticketId) as
      | PassRow
      | undefined
    return row ? toPass(row) : null
  }

  function pass(id: number): SecurityPass {
    return toPass(db.prepare('SELECT * FROM security_pass WHERE id = ?').get(id) as unknown as PassRow)
  }

  /** Says it in the round's `#prs` thread, where the rest of the round is said. */
  function announce(review: { messageId: number }, text: string): void {
    chat.reply({ authorId: COMPANY_AUTHOR, messageId: review.messageId, text })
  }

  /** The pass the caller is reading; throws in the words of whoever it is actually for. */
  function pending(ticketId: number, employeeId: string): SecurityPass {
    const found = latest(ticketId)
    if (!found) throw new Error(`${idOf(ticketId)} has no security pass`)
    if (found.reviewerId !== employeeId) {
      throw new Error(`The security pass on ${idOf(ticketId)} is ${nameOf(found.reviewerId)}’s, not yours`)
    }
    if (found.state !== 'pending') throw new Error(`The security pass on ${idOf(ticketId)} is closed`)
    return found
  }

  /** Fires `onCleared` when nothing about the pass holds the merge any more. */
  function cleared(ticketId: number): void {
    const found = latest(ticketId)
    if (found && !holdsTheMerge(found)) onCleared(ticketId)
  }

  function required(value: string, what: string): string {
    const text = value.trim()
    if (!text) throw new Error(`A security finding needs ${what}`)
    return text
  }

  const security: CompanySecurity = {
    of: latest,

    list() {
      const rows = db
        .prepare(
          'SELECT * FROM security_pass WHERE id IN (SELECT MAX(id) FROM security_pass GROUP BY ticket_id) ' +
            'ORDER BY ticket_id',
        )
        .all() as unknown as PassRow[]
      return rows.map(toPass)
    },

    roundStarted(review) {
      const row = ticket(review.ticketId)
      if (!row) return
      const reviewerId = routing.securityReviewer(row.assignee_id ?? BOSS)
      // No Security Employee, no pass: a Company that never hired one merges exactly as it did.
      if (!reviewerId) return
      if (latest(review.ticketId)?.reviewId === review.id) return
      const scope = security.scope()
      if (scope === 'off') return
      void (async () => {
        const changed = await paths(review.ticketId)
        if (!db.isOpen) return
        const current = ticket(review.ticketId)
        if (!current) return
        const reason = securityReason({ scope, paths: changed, labels: labelsOf(current) })
        if (!reason) return
        if (latest(review.ticketId)?.reviewId === review.id) return
        start(review, current, reviewerId, reason)
      })().catch((error: unknown) => log(`Could not start the security pass on ${idOf(review.ticketId)}: ${error}`))
    },

    refusal(ticketId) {
      const found = latest(ticketId)
      return found ? securityRefusal(found, idOf(ticketId)) : null
    },

    override(ticketId, reason) {
      const found = latest(ticketId)
      if (!found) throw new Error(`${idOf(ticketId)} has no security pass`)
      const text = reason.trim()
      if (!text) throw new Error('An override needs a reason: it is what the record of it is for')
      if (found.state === 'overridden') throw new Error(`The security pass on ${idOf(ticketId)} is already overridden`)
      db.prepare(
        'UPDATE security_pass SET state = ?, overridden_by = ?, override_reason = ?, finished_at = ? WHERE id = ?',
      ).run('overridden', BOSS, text, new Date().toISOString(), found.id)
      onChange()
      const open = blockingFindings(found)
      chat.post({
        authorId: COMPANY_AUTHOR,
        channelId: PRS_CHANNEL,
        text:
          `@${BOSS} overrode the security pass on ${idOf(ticketId)}: ${text}` +
          (open.length > 0 ? ` (${open.length} high still open: ${open.map((f) => f.title).join('; ')})` : ''),
      })
      cleared(ticketId)
      return pass(found.id)
    },

    recheck: cleared,

    scope() {
      const row = db.prepare('SELECT scope FROM security_setting WHERE id = 1').get() as { scope: string } | undefined
      const found = SECURITY_SCOPES.find((scope) => scope === row?.scope)
      return found ?? DEFAULT_SECURITY_SCOPE
    },

    setScope(scope) {
      if (!SECURITY_SCOPES.includes(scope)) throw new Error(`Unknown security scope: ${String(scope)}`)
      db.prepare('INSERT INTO security_setting (id, scope) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET scope = ?').run(
        scope,
        scope,
      )
      onChange()
      return scope
    },

    as(employeeId) {
      return {
        pass: (ticketId) => {
          const found = latest(ticketId)
          return found?.reviewerId === employeeId ? found : null
        },

        file(input) {
          const found = pending(input.ticketId, employeeId)
          if (!SECURITY_SEVERITIES.includes(input.severity)) {
            throw new Error(`A severity is one of ${SECURITY_SEVERITIES.join(', ')}`)
          }
          const title = required(input.title, 'a one-line title')
          const fix = required(input.fix, 'a concrete fix — the change you would make, not advice')
          const thread = threads.open(
            {
              ticketId: input.ticketId,
              ...(input.repo !== undefined && { repoId: input.repo }),
              ...(input.file !== undefined && { path: input.file }),
              ...(input.line !== undefined && { line: input.line }),
              body: findingBody({ ...input, title, fix }),
              // A finding is a note at the round's level: the merge gate is the one it blocks, so a
              // security finding never decides whether the reviewer and the assignee are finished.
              blocking: false,
            },
            employeeId,
          )
          const now = new Date().toISOString()
          const { lastInsertRowid } = db
            .prepare(
              'INSERT INTO security_finding (pass_id, ticket_id, severity, title, fix, thread_id, created_at) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(found.id, input.ticketId, input.severity, title, fix, thread.id, now)
          onChange()
          const filed = findingsOf(input.ticketId).find((finding) => finding.id === Number(lastInsertRowid))
          if (!filed) throw new Error('The finding was not written')
          return filed
        },

        resolve(findingId) {
          const row = db.prepare('SELECT * FROM security_finding WHERE id = ?').get(findingId) as FindingRow | undefined
          if (!row) throw new Error(`There is no security finding ${findingId}`)
          const found = latest(row.ticket_id)
          if (found?.reviewerId !== employeeId) {
            throw new Error(`The security pass on ${idOf(row.ticket_id)} is not yours`)
          }
          threads.setState(row.thread_id, 'resolved', employeeId)
          onChange()
          cleared(row.ticket_id)
          const resolved = findingsOf(row.ticket_id).find((finding) => finding.id === findingId)
          if (!resolved) throw new Error('The finding was not written')
          return resolved
        },

        submit({ ticketId, summary }) {
          const found = pending(ticketId, employeeId)
          const said = summary.trim()
          if (!said) throw new Error('A security pass ends with a summary of what you read and what you found')
          const blocking = blockingFindings(found).length
          const state: SecurityPassState = found.findings.length === 0 ? 'clear' : 'findings'
          db.prepare('UPDATE security_pass SET state = ?, summary = ?, finished_at = ? WHERE id = ?').run(
            state,
            said,
            new Date().toISOString(),
            found.id,
          )
          onChange()
          chat.post({
            authorId: COMPANY_AUTHOR,
            channelId: PRS_CHANNEL,
            text:
              `${nameOf(employeeId)} finished the security pass on ${idOf(ticketId)}: ${said}` +
              (blocking > 0 ? ` — ${blocking} high open, the merge waits.` : ''),
          })
          cleared(ticketId)
          return pass(found.id)
        },
      }
    },
  }

  /** Writes the pass row and wakes the Security Employee with the change and the scale. */
  function start(
    review: Review,
    row: { id: number; title: string; assignee_id: string | null },
    reviewerId: string,
    reason: SecurityReason,
  ): void {
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO security_pass (ticket_id, review_id, reviewer_id, reason_kind, reason_classes, started_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
    ).run(row.id, review.id, reviewerId, reason.kind, JSON.stringify(reason.classes), now)
    onChange()
    const why =
      reason.kind === 'every'
        ? 'this Company asks for a pass on every pull request'
        : reason.kind === 'label'
          ? 'the ticket is labelled for it'
          : `it touches ${riskLine(reason.classes)}`
    announce(review, `Security pass requested from ${nameOf(reviewerId)}: ${why}.`)
    deliver({
      employeeId: reviewerId,
      kind: 'review',
      fromId: row.assignee_id ?? BOSS,
      channelId: PRS_CHANNEL,
      threadId: review.messageId,
      messageId: null,
      ticketId: row.id,
      text: `Security pass on ${ticketSubject(companyKeyOf(db), row.id, row.title)}`,
      prompt:
        `[company] security pass on ticket ${idOf(row.id)} ${JSON.stringify(row.title)}, because ${why}. ` +
        `${nameOf(review.reviewerId)} is doing the normal review; you read the same change for security only. ` +
        'Read it read-only: `git diff <base>...<branch>` and the files in the worktree, never editing, ' +
        'committing or checking anything out there. Threat model the change first, then read the lines. ' +
        'File each finding with security_finding — severity, a one-line title, and a concrete fix; it goes on ' +
        'the PR as a review comment on that line. The scale: ' +
        SECURITY_SEVERITIES.map((severity) => `${severity} — ${SEVERITY_MEANING[severity]}`).join(' ') +
        ' Settle a finding whose fix has landed with security_resolve, and end with security_submit and a ' +
        'summary of what you read. A high finding still open holds the merge until it is resolved or the boss ' +
        'overrides the pass. Talk through the company MCP server, never in plain text.',
    })
  }

  return security
}

/** The thread a finding goes up as: what is wrong, where it bites, and the fix, in that order. */
function findingBody(input: { severity: SecuritySeverity; title: string; fix: string; detail?: string }): string {
  return (
    `**Security · ${input.severity}** — ${input.title}` +
    (input.detail?.trim() ? `\n\n${input.detail.trim()}` : '') +
    `\n\n**Fix:** ${input.fix}`
  )
}
