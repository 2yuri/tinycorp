/**
 * Review threads: the conversation two Employees have about a change, on the PR itself.
 *
 * A review has rounds; a round has threads; a thread has messages. The reviewer opens a thread on
 * a line, the assignee answers it — with a fix and its commit, or with a reason not to — and the
 * reviewer resolves it or leaves it as a note. Only when the reviewer approves, or the round limit
 * says the argument is the boss's to settle, does any of it become something the boss is asked
 * about (T170).
 */

/**
 * Where a thread stands. `open` blocks the approval; `non_blocking` is a note the reviewer left
 * deliberately, which does not; `resolved` is settled, and collapses in the diff.
 */
export const THREAD_STATES = ['open', 'resolved', 'non_blocking'] as const
export type ThreadState = (typeof THREAD_STATES)[number]

/** One message in a review thread, by the reviewer, the assignee or the boss. */
export interface ThreadMessage {
  id: number
  threadId: number
  /** The ticket's round this was written in, counting from 1. */
  round: number
  /** `BOSS` or an Employee id. */
  authorId: string
  body: string
  /** The commit the author says answers the thread, as they named it; null when they named none. */
  commit: string | null
  /** Where the message landed on the forge, or null when it never left the app. */
  url: string | null
  createdAt: string
}

/**
 * One thread of a review: anchored to `path:line` of a repo's PR, or to the PR as a whole when it
 * has no file.
 */
export interface ReviewThread {
  id: number
  ticketId: number
  /** The round it was opened in. */
  round: number
  /** The repo whose PR it hangs on; null for a thread that belongs to no repo. */
  repoId: string | null
  /** The file at the head, or null for a thread about the change as a whole. */
  path: string | null
  /** The line of the head the thread hangs under; null with no file. */
  line: number | null
  state: ThreadState
  /** Who resolved it and when; null while it is not resolved. */
  resolvedBy: string | null
  resolvedAt: string | null
  /** The commit that answered it, as the assignee named it; null when none was named. */
  commit: string | null
  /** The thread on the forge, or null when it never left the app. */
  url: string | null
  createdAt: string
  /** Its messages, oldest first; never empty. */
  messages: ThreadMessage[]
}

/** What a reviewer opens a thread with. */
export interface NewReviewThread {
  ticketId: number
  /** Left out, the thread hangs on the ticket's only PR. */
  repoId?: string
  path?: string
  line?: number
  body: string
  /** False leaves the thread as a note the reviewer will not block the approval on. */
  blocking?: boolean
}

/** The threads that stop an approval: open, and not marked as notes. */
export function blockingThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((thread) => thread.state === 'open')
}

/** Every thread that is not resolved, notes included — what the diff still draws expanded. */
export function unresolvedThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((thread) => thread.state !== 'resolved')
}

/** `5 of 6 threads resolved`, as the reviewer card writes it; empty when there are none. */
export function threadsResolvedLabel(threads: readonly ReviewThread[]): string {
  if (threads.length === 0) return ''
  const done = threads.filter((thread) => thread.state === 'resolved').length
  return `${done} of ${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} resolved`
}

/** `1 open thread` / `3 open threads`, counting notes as open; empty when none is. */
export function openThreadsLabel(threads: readonly ReviewThread[]): string {
  const open = unresolvedThreads(threads).length
  if (open === 0) return ''
  return `${open} open ${open === 1 ? 'thread' : 'threads'}`
}

/** `src/format/currency.ts:20`, or `the pull request` for a thread with no file. */
export function threadAnchor(thread: Pick<ReviewThread, 'path' | 'line'>): string {
  if (!thread.path) return 'the pull request'
  return thread.line === null ? thread.path : `${thread.path}:${thread.line}`
}
