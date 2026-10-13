import { useEffect, useState } from 'react'
import type { PullRequestDetails } from '../../../shared/code'
import type { Company } from '../../../shared/company'
import type { BoardSnapshot } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import type { Repo } from '../../../shared/repos/repo'
import type { Review } from '../../../shared/review'
import type { RepoDiff, ReviewComment } from '../../../shared/review/review-diff'
import type { ReviewThread } from '../../../shared/review/review-threads'
import type { SecurityPass } from '../../../shared/review/security'
import { resources, useIpcResource } from '../ipc'

/** Everything the Review screen reads about one ticket, kept live over IPC. */
export interface ReviewData {
  board: BoardSnapshot | null
  employees: Employee[]
  repos: Repo[]
  company: Company | null
  review: Review | null
  details: PullRequestDetails[]
  diffs: RepoDiff[]
  comments: ReviewComment[]
  /** The ticket's review conversation (T170). */
  threads: ReviewThread[]
  /** Whether the forges are carrying it; false means the panel says it stays in the app. */
  threadsOnForge: boolean
  /** The ticket's security pass (T241), or null when it never had one. */
  security: SecurityPass | null
  /** Null until the first read; a message when a read failed. */
  error: string | null
  /** True until the first diff read comes back. */
  loading: boolean
}

/** The change itself: what the screen cannot draw anything without. */
type TicketChange = Pick<ReviewData, 'details' | 'diffs' | 'error' | 'loading'>

/** What is said about the change: it arrives on its own, and the diff never waits for it. */
type TicketTalk = Pick<ReviewData, 'comments' | 'threads' | 'threadsOnForge'>

const EMPTY_CHANGE: TicketChange = { details: [], diffs: [], error: null, loading: true }

const EMPTY_TALK: TicketTalk = { comments: [], threads: [], threadsOnForge: false }

const value = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T | null =>
  result.ok ? result.value : null

/**
 * Reads the ticket's review round, PR details, diff and line comments, again after every review,
 * code or board change; the board, the people and the repos are the shared channels every other
 * screen reads (T212). The diff is cached in the engine, so refreshing it costs nothing while its
 * TTL holds.
 */
export function useReviewData(ticketId: number): ReviewData {
  const board = useIpcResource(resources.board)
  const employees = useIpcResource(resources.employees)
  const repos = useIpcResource(resources.repos)
  const company = useIpcResource(resources.company)
  const reviews = useIpcResource(resources.reviews)
  const passes = useIpcResource(resources.securityPasses)
  const [change, setChange] = useState<TicketChange>(EMPTY_CHANGE)
  const [talk, setTalk] = useState<TicketTalk>(EMPTY_TALK)

  /*
   * Two reads, not one (T243). Before this, the screen waited on the forge's `threads` call before
   * it drew a single line of the diff: one slow network answer and the whole review sat blank. The
   * change and what is said about it are separate questions and land separately — the diff as soon
   * as git has it, the conversation whenever the forge answers.
   */
  useEffect(() => {
    const api = window.tinyCorp
    let live = true
    async function readChange(): Promise<void> {
      const [details, diffs] = await Promise.all([api.code.details(ticketId), api.reviews.diff(ticketId)])
      if (!live) return
      const failure = [details, diffs].find((result) => !result.ok)
      setChange({
        details: value(details) ?? [],
        diffs: value(diffs) ?? [],
        error: failure && !failure.ok ? failure.error : null,
        loading: false,
      })
    }
    async function readTalk(): Promise<void> {
      const [comments, threads, onForge] = await Promise.all([
        api.reviews.comments(ticketId),
        api.reviews.threads(ticketId),
        api.reviews.threadsOnForge(ticketId),
      ])
      if (!live) return
      setTalk({
        comments: value(comments) ?? [],
        threads: value(threads) ?? [],
        threadsOnForge: value(onForge) ?? false,
      })
    }
    const refresh = () => {
      void readChange()
      void readTalk()
    }
    refresh()
    const offs = [api.reviews.onChanged(refresh), api.code.onChanged(refresh)]
    return () => {
      live = false
      for (const off of offs) off()
    }
  }, [ticketId])

  return {
    board,
    employees,
    repos,
    company,
    review: reviews.find((review) => review.ticketId === ticketId) ?? null,
    security: passes.find((pass) => pass.ticketId === ticketId) ?? null,
    ...change,
    ...talk,
  }
}
