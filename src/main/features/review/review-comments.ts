import type { DatabaseSync } from 'node:sqlite'
import { BOSS } from '../../../shared/domain/chat'
import type { NewReviewComment, ReviewComment } from '../../../shared/review/review-diff'
import type { Migration } from '../../core'
import { ticketCodeIn } from '../../core'
import type { GitService } from '../../platform'
import type { CodeFlow } from '../code'
import { PRS_CHANNEL } from '../code'
import type { NewInboxItem } from '../inbox'

/**
 * The review comments' migration step, appended to the engine's migrations: one row per line
 * comment the boss wrote in the app, whether or not the forge took a copy.
 */
export const REVIEW_COMMENTS_MIGRATION: Migration = {
  name: 'review-line-comments',
  sql: `
  CREATE TABLE review_comment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    repo_id TEXT NOT NULL,
    path TEXT NOT NULL,
    line INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX review_comment_by_ticket ON review_comment (ticket_id, id);
`,
}

/** A ticket's line comments, and writing one. */
export interface ReviewComments {
  /** Every line comment on a ticket, oldest first. */
  list(ticketId: number): ReviewComment[]
  /**
   * Writes a line comment as `authorId`. It is kept in the Company either way, posted on the PR
   * on the PR through the repo's forge when there is one, and wakes the ticket's assignee.
   */
  add(input: NewReviewComment, authorId?: string): ReviewComment
}

export interface ReviewCommentsOptions {
  db: DatabaseSync
  code: CodeFlow
  /** Files an inbox item for this Company. */
  deliver(item: NewInboxItem): void
  /** Without one, comments are kept in the Company but never reach the forge. */
  git?: GitService
  onChange(): void
  log(line: string): void
}

interface Row {
  id: number
  ticket_id: number
  repo_id: string
  path: string
  line: number
  author_id: string
  body: string
  url: string | null
  created_at: string
}

interface TicketRow {
  id: number
  title: string
  assignee_id: string | null
}

export function createReviewComments({ db, code, deliver, git, onChange, log }: ReviewCommentsOptions): ReviewComments {
  function toComment(row: Row): ReviewComment {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      repoId: row.repo_id,
      path: row.path,
      line: row.line,
      authorId: row.author_id,
      body: row.body,
      url: row.url,
      createdAt: row.created_at,
    }
  }

  function repo(id: string): { name: string; path: string } | undefined {
    return db.prepare('SELECT name, path FROM repo WHERE id = ?').get(id) as { name: string; path: string } | undefined
  }

  /** Posts the comment on the PR and records the URL the forge gave it. */
  function post(comment: ReviewComment, url: string, repoPath: string): void {
    if (!git) return
    git
      .commentOnPullRequestLine({ repoPath, url, path: comment.path, line: comment.line, body: comment.body })
      .then((posted) => {
        if (!db.isOpen || posted === null) return
        db.prepare('UPDATE review_comment SET url = ? WHERE id = ?').run(posted, comment.id)
        onChange()
      })
      .catch((error: unknown) => log(`Could not comment on ${url} ${comment.path}:${comment.line}: ${String(error)}`))
  }

  /** Tells the ticket's assignee what was written, so they can answer it in their worktree. */
  function wake(comment: ReviewComment, ticket: TicketRow, repoName: string): void {
    const assignee = ticket.assignee_id
    if (!assignee || assignee === comment.authorId) return
    const where = `${repoName} ${comment.path}:${comment.line}`
    deliver({
      employeeId: assignee,
      kind: 'review',
      fromId: comment.authorId,
      channelId: PRS_CHANNEL,
      threadId: null,
      messageId: null,
      ticketId: ticket.id,
      text: `Review comment on ${where}: ${comment.body}`,
      prompt:
        `[company] a review comment on your ticket ${ticketCodeIn(db, ticket.id)} ${JSON.stringify(ticket.title)}, ` +
        `on ${where}: ${JSON.stringify(comment.body)}. Read that line in your worktree and answer it: ` +
        'fix it and push, or reply in the PR thread saying why not. ' +
        'Talk through the company MCP server, never in plain text.',
    })
  }

  return {
    list(ticketId) {
      const rows = db
        .prepare('SELECT * FROM review_comment WHERE ticket_id = ? ORDER BY id')
        .all(ticketId) as unknown as Row[]
      return rows.map(toComment)
    },

    add(input, authorId = BOSS) {
      const body = input.body.trim()
      if (!body) throw new Error('A comment needs some text')
      if (!Number.isInteger(input.line) || input.line < 1) throw new Error('A comment needs a line')
      if (!input.path) throw new Error('A comment needs a file')
      const ticket = db.prepare('SELECT id, title, assignee_id FROM ticket WHERE id = ?').get(input.ticketId) as
        | TicketRow
        | undefined
      if (!ticket) throw new Error(`There is no ticket ${ticketCodeIn(db, input.ticketId)}`)
      const found = repo(input.repoId)
      if (!found) throw new Error('That repo is not in the Company')
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO review_comment (ticket_id, repo_id, path, line, author_id, body, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(ticket.id, input.repoId, input.path, input.line, authorId, body, new Date().toISOString())
      const row = db.prepare('SELECT * FROM review_comment WHERE id = ?').get(Number(lastInsertRowid)) as unknown as Row
      const comment = toComment(row)
      onChange()
      const pr = code.of(ticket.id).pullRequests.find((p) => p.repoId === input.repoId)
      if (pr) post(comment, pr.url, found.path)
      wake(comment, ticket, found.name)
      return comment
    },
  }
}
