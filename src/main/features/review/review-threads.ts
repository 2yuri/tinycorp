import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_ROUND_LIMIT } from '../../../shared/review'
import type { NewReviewThread, ReviewThread, ThreadMessage, ThreadState } from '../../../shared/review/review-threads'
import type { Migration } from '../../core'
import { ticketCodeIn } from '../../core'
import type { ReviewVerdictOnForge } from '../../forges'
import type { GitService, ReviewThreadDraft } from '../../platform'
import type { CodeFlow } from '../code'

/**
 * Review threads' migration step: one row per thread of a review round, one per message in it, and
 * the Company's round limit (T170).
 *
 * The threads are the review. The `review` row is only the round they belong to, and the older
 * `review_comment` table is left where it is: it is the boss writing on a worktree's diff in the
 * Files view, which has no round and no reviewer to answer it.
 */
export const REVIEW_THREADS_MIGRATION: Migration = {
  name: 'review-threads-and-round-limit',
  sql: `
  CREATE TABLE review_thread (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES ticket (id),
    review_id INTEGER NOT NULL REFERENCES review (id),
    repo_id TEXT,
    path TEXT,
    line INTEGER,
    state TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    resolved_at TEXT,
    commit_sha TEXT,
    forge_id TEXT,
    url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX review_thread_by_ticket ON review_thread (ticket_id, id);
  CREATE TABLE review_thread_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES review_thread (id),
    review_id INTEGER NOT NULL REFERENCES review (id),
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    commit_sha TEXT,
    url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX review_thread_message_by_thread ON review_thread_message (thread_id, id);
  CREATE TABLE review_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    round_limit INTEGER NOT NULL
  );
`,
}

/** A ticket's review conversation, and the Company's round limit. */
export interface ReviewThreads {
  /** Every thread of a ticket, oldest first, each with its messages. */
  list(ticketId: number): ReviewThread[]
  /** One thread, or null when there is none with that id. */
  get(threadId: number): ReviewThread | null
  /**
   * Opens a thread in the ticket's current round, as `authorId`. It reaches the forge when the
   * round closes (the reviewer's) or at once (anyone else's) — see {@link publish}.
   */
  open(input: NewReviewThread, authorId: string): ReviewThread
  /** Answers a thread. A `commit` is the change the author says settles it. */
  reply(input: { threadId: number; body: string; commit?: string }, authorId: string): ReviewThread
  /** Moves a thread to `state` as `authorId`, and mirrors a resolution to the forge. */
  setState(threadId: number, state: ThreadState, authorId: string): ReviewThread
  /**
   * Sends every thread of `threadIds` that has not reached its forge yet, as one review per repo
   * PR, carrying `summary` and `verdict`. Threads already on the forge are left alone.
   */
  publish(input: { ticketId: number; threadIds: number[]; summary: string; verdict: ReviewVerdictOnForge }): void
  /** How many rounds this Company gives its agents before the argument is the boss's. */
  roundLimit(): number
  setRoundLimit(rounds: number): number
  /** Whether every repo of the ticket can hold the conversation on its PR; false says the panel must say so. */
  onForge(ticketId: number): boolean
}

export interface ReviewThreadsOptions {
  db: DatabaseSync
  code: CodeFlow
  /** Without one, threads live in the app alone. */
  git?: GitService
  onChange(): void
  log(line: string): void
}

interface ThreadRow {
  id: number
  ticket_id: number
  review_id: number
  repo_id: string | null
  path: string | null
  line: number | null
  state: ThreadState
  resolved_by: string | null
  resolved_at: string | null
  commit_sha: string | null
  forge_id: string | null
  url: string | null
  created_at: string
}

interface MessageRow {
  id: number
  thread_id: number
  review_id: number
  author_id: string
  body: string
  commit_sha: string | null
  url: string | null
  created_at: string
}

export function createReviewThreads({ db, code, git, onChange, log }: ReviewThreadsOptions): ReviewThreads {
  /** Which round of its ticket a review row is, counting from 1 — never the Company-wide row id. */
  function roundOf(ticketId: number, reviewId: number): number {
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM review WHERE ticket_id = ? AND id <= ?')
      .get(ticketId, reviewId) as { n: number }
    return Number(row.n)
  }

  /** The ticket's round under way, or null before its first. */
  function currentRound(ticketId: number): number | null {
    const row = db.prepare('SELECT id FROM review WHERE ticket_id = ? ORDER BY id DESC LIMIT 1').get(ticketId) as
      | { id: number }
      | undefined
    return row?.id ?? null
  }

  function messagesOf(threadId: number, ticketId: number): ThreadMessage[] {
    const rows = db
      .prepare('SELECT * FROM review_thread_message WHERE thread_id = ? ORDER BY id')
      .all(threadId) as unknown as MessageRow[]
    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      round: roundOf(ticketId, row.review_id),
      authorId: row.author_id,
      body: row.body,
      commit: row.commit_sha,
      url: row.url,
      createdAt: row.created_at,
    }))
  }

  function toThread(row: ThreadRow): ReviewThread {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      round: roundOf(row.ticket_id, row.review_id),
      repoId: row.repo_id,
      path: row.path,
      line: row.line,
      state: row.state,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      commit: row.commit_sha,
      url: row.url,
      createdAt: row.created_at,
      messages: messagesOf(row.id, row.ticket_id),
    }
  }

  function rowOf(threadId: number): ThreadRow | undefined {
    return db.prepare('SELECT * FROM review_thread WHERE id = ?').get(threadId) as ThreadRow | undefined
  }

  function repo(id: string | null): { name: string; path: string } | undefined {
    if (!id) return undefined
    return db.prepare('SELECT name, path FROM repo WHERE id = ?').get(id) as { name: string; path: string } | undefined
  }

  /** The PR a thread hangs on, with the checkout its forge is driven from; null when it has none. */
  function placeOf(thread: ThreadRow): { repoPath: string; url: string } | null {
    const found = repo(thread.repo_id)
    const pr = code.of(thread.ticket_id).pullRequests.find((p) => p.repoId === thread.repo_id)
    return found && pr ? { repoPath: found.path, url: pr.url } : null
  }

  /** What opened a thread: the body the forge's own thread is created with. */
  function firstBody(threadId: number): string {
    const row = db
      .prepare('SELECT body FROM review_thread_message WHERE thread_id = ? ORDER BY id LIMIT 1')
      .get(threadId) as { body: string } | undefined
    return row?.body ?? ''
  }

  /** Records where the forge put a thread, so a later reply and resolution land in the same place. */
  function landed(threadId: number, forgeId: string, url: string | null): void {
    if (!db.isOpen) return
    db.prepare('UPDATE review_thread SET forge_id = ?, url = ? WHERE id = ?').run(forgeId, url, threadId)
    // The thread's first message is the one the forge now holds, so it carries the same link.
    const first = db
      .prepare('SELECT id FROM review_thread_message WHERE thread_id = ? ORDER BY id LIMIT 1')
      .get(threadId) as { id: number } | undefined
    if (first && url) db.prepare('UPDATE review_thread_message SET url = ? WHERE id = ?').run(url, first.id)
    onChange()
  }

  const threads: ReviewThreads = {
    list(ticketId) {
      const rows = db
        .prepare('SELECT * FROM review_thread WHERE ticket_id = ? ORDER BY id')
        .all(ticketId) as unknown as ThreadRow[]
      return rows.map(toThread)
    },

    get(threadId) {
      const row = rowOf(threadId)
      return row ? toThread(row) : null
    },

    open(input, authorId) {
      const body = input.body.trim()
      if (!body) throw new Error('A review comment needs some text')
      const reviewId = currentRound(input.ticketId)
      if (reviewId === null) throw new Error(`${ticketCodeIn(db, input.ticketId)} is not in review`)
      const pulls = code.of(input.ticketId).pullRequests
      // A file with no repo named belongs to the only PR there is; with several, say which.
      const repoId = input.repoId ?? (pulls.length === 1 ? pulls[0]!.repoId : null)
      if (input.path && !repoId) throw new Error('Say which repo the file is in: this ticket spans several')
      if (repoId && !repo(repoId)) throw new Error('That repo is not in the Company')
      if (input.path !== undefined && (!Number.isInteger(input.line) || (input.line ?? 0) < 1)) {
        throw new Error('A comment on a file needs a line')
      }
      const now = new Date().toISOString()
      const state: ThreadState = input.blocking === false ? 'non_blocking' : 'open'
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO review_thread (ticket_id, review_id, repo_id, path, line, state, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(input.ticketId, reviewId, input.path ? repoId : null, input.path ?? null, input.line ?? null, state, now)
      const threadId = Number(lastInsertRowid)
      db.prepare(
        'INSERT INTO review_thread_message (thread_id, review_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(threadId, reviewId, authorId, body, now)
      onChange()
      return toThread(rowOf(threadId)!)
    },

    reply({ threadId, body, commit }, authorId) {
      const text = body.trim()
      if (!text) throw new Error('A reply needs some text')
      const row = rowOf(threadId)
      if (!row) throw new Error(`There is no review thread ${threadId}`)
      const reviewId = currentRound(row.ticket_id) ?? row.review_id
      const sha = commit?.trim() || null
      db.prepare(
        'INSERT INTO review_thread_message (thread_id, review_id, author_id, body, commit_sha, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      ).run(threadId, reviewId, authorId, text, sha, new Date().toISOString())
      // The thread remembers the last commit anyone named for it: that is the chip the diff draws.
      if (sha) db.prepare('UPDATE review_thread SET commit_sha = ? WHERE id = ?').run(sha, threadId)
      onChange()
      const place = row.forge_id ? placeOf(row) : null
      if (place && git && row.forge_id) {
        git
          .replyInThread({ ...place, threadId: row.forge_id, body: text })
          .catch((error: unknown) => log(`Could not reply in the thread on ${place.url}: ${String(error)}`))
      }
      return toThread(rowOf(threadId)!)
    },

    setState(threadId, state, authorId) {
      const row = rowOf(threadId)
      if (!row) throw new Error(`There is no review thread ${threadId}`)
      const resolved = state === 'resolved'
      db.prepare('UPDATE review_thread SET state = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
        state,
        resolved ? authorId : null,
        resolved ? new Date().toISOString() : null,
        threadId,
      )
      onChange()
      const place = row.forge_id ? placeOf(row) : null
      if (resolved && place && git && row.forge_id) {
        git
          .resolveThread({ ...place, threadId: row.forge_id })
          .catch((error: unknown) => log(`Could not resolve the thread on ${place.url}: ${String(error)}`))
      }
      return toThread(rowOf(threadId)!)
    },

    /**
     * One round, one review per PR. The threads of a round are held in the app while the reviewer
     * is still writing them, and go up together when the round closes — that is what makes the PR
     * carry a review rather than a trail of comments (T170).
     */
    publish({ ticketId, threadIds, summary, verdict }) {
      if (!git) return
      const service = git
      const wanted = new Set(threadIds)
      const rows = (
        db
          .prepare('SELECT * FROM review_thread WHERE ticket_id = ? ORDER BY id')
          .all(ticketId) as unknown as ThreadRow[]
      ).filter((row) => wanted.has(row.id) && row.forge_id === null)
      const pulls = code.of(ticketId).pullRequests
      // A summary with nothing to say about a line still goes up, on every PR of the ticket, and
      // a thread about the change as a whole rides with it: no forge can anchor one to a line.
      const wide = rows.filter((row) => row.path === null).map((row) => firstBody(row.id))
      const body = [summary.trim(), ...wide].filter(Boolean).join('\n\n')
      const repoIds = [...new Set([...pulls.map((p) => p.repoId), ...rows.map((r) => r.repo_id)])].filter(
        (id): id is string => id !== null,
      )
      for (const repoId of repoIds) {
        const found = repo(repoId)
        const pr = pulls.find((p) => p.repoId === repoId)
        if (!found || !pr) continue
        const mine = rows.filter((row) => row.repo_id === repoId && row.path !== null && row.line !== null)
        const drafts: ReviewThreadDraft[] = mine.map((row) => ({
          path: row.path!,
          line: row.line!,
          body: firstBody(row.id),
        }))
        if (drafts.length === 0 && !body) continue
        service
          .postReview({ repoPath: found.path, url: pr.url, summary: body, verdict, threads: drafts })
          .then((posted) => {
            if (!posted) return
            posted.threads.forEach((thread, index) => {
              const row = mine[index]
              if (row) landed(row.id, thread.id, thread.url)
            })
          })
          .catch((error: unknown) => log(`Could not post the review on ${pr.url}: ${String(error)}`))
      }
    },

    roundLimit() {
      const row = db.prepare('SELECT round_limit FROM review_setting WHERE id = 1').get() as
        | { round_limit: number }
        | undefined
      return row?.round_limit ?? DEFAULT_ROUND_LIMIT
    },

    setRoundLimit(rounds) {
      if (!Number.isInteger(rounds) || rounds < 1) throw new Error('The round limit is a whole number from 1')
      db.prepare(
        'INSERT INTO review_setting (id, round_limit) VALUES (1, ?) ' +
          'ON CONFLICT (id) DO UPDATE SET round_limit = excluded.round_limit',
      ).run(rounds)
      onChange()
      return rounds
    },

    onForge(ticketId) {
      if (!git) return false
      const pulls = code.of(ticketId).pullRequests
      if (pulls.length === 0) return false
      return pulls.every((pr) => {
        const found = repo(pr.repoId)
        return found ? git.canHoldReview(found.path) : false
      })
    },
  }
  return threads
}
