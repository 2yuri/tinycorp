import { SquareArrowOutUpRight } from 'lucide-react'
import { useState } from 'react'
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { MergeState, Review } from '../../../shared/review'
import { Button, cx } from '../ui'
import { openReview } from './open-review'

/** Read at call time, so the card renders in a test without a window. */
const api = () => window.tinyCorp.reviews

const STATUS_LABEL: Record<Review['status'], string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
}

const MERGE_LABEL: Record<MergeState, string> = {
  waiting: 'Merge waits for your approval',
  merging: 'Merging…',
  merged: 'Merged',
  failed: 'Merge failed',
  rejected: 'Merge rejected',
  refused: 'Merge refused by the repo',
}

export interface TicketReviewProps {
  ticketId: number
  /** The ticket's latest review round, or undefined before the first one. */
  review: Review | undefined
  /** Whether the Review screen has anything to show for this ticket (T82). */
  canOpen: boolean
  /** Whether the boss may decide this round now: the ticket is in Review and no merge is under way. */
  decidable: boolean
  /** The Company's Employees, to name the reviewer. */
  employees: Employee[]
  repoName(id: string): string
}

/**
 * The foot of the drawer's CODE & REVIEW card (design `Izdc9`: Card › Actions): `Open review` and
 * the line beside it saying where the round stands, then the boss's verdict while it is theirs to
 * give. Shows nothing when there is no round and no diff to read.
 */
export function TicketReview(props: TicketReviewProps) {
  const { review, ticketId } = props
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function act(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true)
    const result = await action()
    setBusy(false)
    setError(result.ok ? null : result.error)
    if (result.ok) setComments('')
  }

  if (!review && !props.canOpen) return null
  const name = (id: string) => props.employees.find((e) => e.id === id)?.name ?? 'a former employee'
  const reviewer = review ? (review.reviewerId === BOSS ? 'you' : name(review.reviewerId)) : ''
  const decider = review?.decidedBy === BOSS ? 'you' : review?.decidedBy ? name(review.decidedBy) : reviewer
  const waiting = review
    ? `${STATUS_LABEL[review.status]} · ${review.status === 'pending' ? `by ${reviewer}` : `by ${decider}`}`
    : 'No review round yet'
  const canDecide = props.decidable && review && review.merge !== 'merging' && review.merge !== 'merged'

  return (
    <div className="flex w-full flex-col gap-7 font-sans">
      <div className="h-1 w-full bg-border" />
      <div className="flex flex-wrap items-center gap-8">
        {props.canOpen && (
          <Button icon={SquareArrowOutUpRight} onClick={() => openReview({ ticketId })}>
            Open review
          </Button>
        )}
        <span className="text-11-5/[normal] text-muted-foreground">{waiting}</span>
      </div>
      {review?.comments && (
        <blockquote className="m-0 whitespace-pre-wrap border-border border-l-2 pl-8 text-12-5/[inherit] text-muted-foreground">
          {review.comments}
        </blockquote>
      )}
      {review?.merge && (
        <p
          className={cx('m-0 text-12-5/[inherit]', review.merge === 'failed' ? 'text-destructive' : 'text-foreground')}
        >
          {MERGE_LABEL[review.merge]}
          {review.mergedRepoIds.length > 0 && review.merge !== 'merged' && (
            <span className="text-muted-foreground">
              {' '}
              (merged: {review.mergedRepoIds.map(props.repoName).join(', ')})
            </span>
          )}
          {review.mergeError && <span>: {review.mergeError}</span>}
        </p>
      )}
      {canDecide && (
        <div>
          <textarea
            className="box-border w-full resize-y rounded-sm border border-input bg-card px-10 py-8 font-sans text-12-5/[inherit] text-foreground outline-none focus:border-ring"
            placeholder="Comments (required to request changes)"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
          />
          <div className="mt-6 flex flex-wrap gap-6">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act(() => api().approve(ticketId, comments))}
            >
              {review.merge === 'failed' ? 'Retry merge' : 'Approve and merge'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !comments.trim()}
              onClick={() => void act(() => api().requestChanges(ticketId, comments))}
            >
              Request changes
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
