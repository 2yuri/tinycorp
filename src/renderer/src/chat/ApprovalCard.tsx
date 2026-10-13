import {
  ArrowUpDown,
  BadgeCheck,
  Check,
  CircleCheck,
  Cpu,
  FolderGit2,
  Gauge,
  GitMerge,
  GitPullRequestArrow,
  Lock,
  type LucideIcon,
  MessageSquare,
  MessagesSquare,
  Play,
  ShieldQuestion,
  SquareKanban,
  SquarePlus,
  Undo2,
  UserPlus,
  UserRoundMinus,
} from 'lucide-react'
import { useState } from 'react'
import type { Approval, GatedAction } from '../../../shared/approvals'
import { APPROVE_LABEL } from '../../../shared/approvals/approval-summary'
import { reviewTicketOfApproval } from '../../../shared/review/review-entry'
import { ReviewButton } from '../review'
import { Badge, Button, cx, focusOnMount } from '../ui'
import { type ApprovalIcon, approvalDetail, type ChatData, type MessageCard } from './chat-view'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** A card's own quiet action, flat until the pointer is on it. */
const QUIET =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border-0 bg-transparent px-10 py-5 font-semibold text-12/[normal] text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/** One fact on a card: an icon and a word. */
const FACT =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap font-normal text-12/[normal] text-muted-foreground'

/**
 * The `Waiting` badge's two parts, reached through the kit rather than restyled: the label takes
 * chat's soft ink, the dot the warning colour. Each one is a `data-slot` the kit puts on the
 * element (T216), so the reach is a plain class list with nothing in it to escape.
 */
const WAITING = `[&_[data-slot=badge-label]]:text-[#cbd5e1] [[data-theme='light']_&]:[&_[data-slot=badge-label]]:text-secondary-foreground [&_[data-slot=badge-dot]]:bg-brand-warning`

const approvals = window.tinyCorp.approvals

/** One icon per gated action, as the design's cards draw them. */
export const APPROVAL_ICON: Record<GatedAction, LucideIcon> = {
  ticket_create: SquarePlus,
  ticket_reorder: ArrowUpDown,
  assign: BadgeCheck,
  start: Play,
  open_pr: GitPullRequestArrow,
  merge: GitMerge,
  hire: UserPlus,
  fire: UserRoundMinus,
  switch_provider: Cpu,
  process_change: Gauge,
  // An `env_run` with an environment that asks first (T176): the lock the tab draws on prod.
  env_run: Lock,
  other: ShieldQuestion,
}

const FACT_ICON: Record<ApprovalIcon, LucideIcon> = {
  ticket: SquareKanban,
  repo: FolderGit2,
  who: BadgeCheck,
  approved: CircleCheck,
  rejected: Undo2,
  note: MessageSquare,
}

/**
 * The generic approval card under a message: what is asked, why, the facts, and the boss's
 * decision inline (decision 42). PR approvals get the PR card instead.
 */
export function ApprovalCard({
  card,
  onOpenThread,
}: {
  card: Extract<MessageCard, { kind: 'approval' }>
  onOpenThread?: (() => void) | undefined
}) {
  const Icon = APPROVAL_ICON[card.action]
  return (
    <section
      className={cx(
        'flex w-full flex-col rounded-sm border-l-2 bg-card',
        card.status === 'approved' && 'border-l-brand-success',
        card.status === 'rejected' && 'border-l-status-error-foreground',
        card.status !== 'approved' && card.status !== 'rejected' && 'border-l-muted-foreground',
      )}
      aria-label="Approval"
    >
      <header className="flex items-center gap-8 px-14 py-12 text-muted-foreground">
        <Icon size={15} aria-hidden />
        <span className="min-w-0 shrink grow basis-0 font-semibold text-13/[normal] text-foreground">{card.title}</span>
      </header>
      {card.reason && <p className={cx('m-0 px-14 pt-0 pb-10 text-12-5/19', SOFT)}>{card.reason}</p>}
      <div className="flex flex-wrap items-center gap-x-14 gap-y-8 px-14 pt-0 pb-12">
        {card.facts.map((fact) => {
          const FactIcon = FACT_ICON[fact.icon]
          return (
            <span
              key={`${fact.icon}:${fact.label}`}
              className={cx(
                FACT,
                fact.icon === 'approved' && '[&_svg]:text-brand-success',
                fact.icon === 'rejected' && '[&_svg]:text-status-error-foreground',
              )}
            >
              <FactIcon size={13} aria-hidden />
              {fact.label}
            </span>
          )
        })}
        <span className="shrink grow basis-0" />
        {onOpenThread && (
          <button type="button" className={QUIET} onClick={onOpenThread}>
            <MessagesSquare size={13} aria-hidden />
            {card.replies === 0 ? 'Open thread' : `${card.replies} ${card.replies === 1 ? 'reply' : 'replies'}`}
          </button>
        )}
      </div>
      {card.waiting && (
        <div className="px-14 pt-0 pb-12">
          <ApprovalDecision
            approvalId={card.approvalId}
            action={card.action}
            reviewTicketId={card.reviewTicketId}
            size="sm"
            fill={false}
          />
        </div>
      )}
    </section>
  )
}

/**
 * The thread panel's card for an approval that is not about a PR: the message card, opened up. A
 * merge's Review sits in its head, since the panel's decision row holds the two decisions only.
 */
export function ApprovalDetailCard({ approval, data }: { approval: Approval; data: ChatData }) {
  const detail = approvalDetail(approval, data)
  const reviewTicketId = reviewTicketOfApproval(approval)
  const Icon = APPROVAL_ICON[approval.action]
  return (
    <section
      className="flex shrink-0 flex-col gap-10 rounded-sm border border-border bg-card p-14"
      aria-label="Request"
    >
      <div className="flex flex-wrap items-center gap-8 [&>svg]:shrink-0">
        <Icon size={14} aria-hidden />
        <span className={cx('min-w-0 font-semibold text-12/[normal] [overflow-wrap:anywhere]', SOFT)}>
          {detail.kindLabel}
        </span>
        {reviewTicketId !== null && <ReviewButton ticketId={reviewTicketId} />}
        <span className="shrink grow basis-0" />
        {detail.waiting && <WaitingBadge />}
      </div>
      <div className="font-semibold text-14/20 text-foreground [overflow-wrap:anywhere]">{detail.title}</div>
      {detail.reason && <div className={cx('whitespace-pre-wrap text-12-5/19', SOFT)}>{detail.reason}</div>}
      {detail.rows.length > 0 && <div className="h-1 w-full flex-none bg-border" />}
      {detail.rows.map((row) => {
        const RowIcon = FACT_ICON[row.icon]
        return (
          <div
            key={`${row.icon}:${row.label}`}
            className="flex items-center gap-8 text-muted-foreground [&>svg]:shrink-0"
          >
            <RowIcon size={14} aria-hidden />
            <span className={cx('min-w-0 shrink grow basis-0 text-12/[normal] [overflow-wrap:anywhere]', SOFT)}>
              {row.label}
            </span>
            {row.meta && <span className="whitespace-nowrap text-11/[normal] text-muted-foreground">{row.meta}</span>}
          </div>
        )
      })}
    </section>
  )
}

/** The `Waiting on you` pill of the message head and the thread panel's card. */
export function WaitingBadge() {
  return (
    <Badge variant="neutral" className={WAITING}>
      Waiting on you
    </Badge>
  )
}

/**
 * Approve (labelled per kind) and Send back, which asks why inline. `sm` is the row inside a
 * message card; `md` is the thread panel's full-width pair. A merge also offers the diff, so the
 * boss can read what they are approving even where there is no PR to open (T82).
 */
export function ApprovalDecision({
  approvalId,
  action,
  reviewTicketId = null,
  size = 'md',
  fill = true,
}: {
  approvalId: number
  action: GatedAction
  /** The ticket whose Review sits beside the two decisions; null leaves it out. */
  reviewTicketId?: number | null
  size?: 'sm' | 'md'
  /**
   * Whether the pair splits the width between them. The thread panel's pair does; the pair inside
   * a message card, a plan card or an Inbox row stays as wide as its labels. The stylesheet said
   * this with three descendant selectors — `.chat-approval__actions .chat-actions > [data-slot=button]`
   * and its two twins, all three `flex: none` — which is a thing only the container knew. Two
   * utilities in the same layer cannot settle it by specificity, so the container says it here.
   */
  fill?: boolean
}) {
  const [sendingBack, setSendingBack] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    const result = await approvals.decide(approvalId, approve ? { approve } : { approve, reason })
    setError(result.ok ? null : result.error)
    if (result.ok) setSendingBack(false)
  }

  return (
    <>
      {sendingBack ? (
        <form
          className="flex shrink-0 flex-col gap-10"
          onSubmit={(event) => {
            event.preventDefault()
            void decide(false)
          }}
        >
          <input
            ref={focusOnMount}
            className="w-full rounded-sm border border-input bg-card px-12 py-10 text-13/[normal] text-foreground outline-none focus:border-ring focus:shadow-focus"
            value={reason}
            placeholder="What should change?"
            aria-label="Why send it back"
            onChange={(event) => setReason(event.target.value)}
          />
          <div
            className={cx(
              'flex shrink-0 gap-10',
              fill
                ? '[&>[data-slot=button]]:min-w-0 [&>[data-slot=button]]:shrink [&>[data-slot=button]]:grow [&>[data-slot=button]]:basis-0'
                : '[&>[data-slot=button]]:flex-none',
            )}
          >
            <Button type="submit" size={size} variant="destructive" icon={Undo2} disabled={!reason.trim()}>
              Send back
            </Button>
            <Button size={size} variant="outline" onClick={() => setSendingBack(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={cx(
            'flex shrink-0 gap-10',
            fill
              ? '[&>[data-slot=button]]:min-w-0 [&>[data-slot=button]]:shrink [&>[data-slot=button]]:grow [&>[data-slot=button]]:basis-0'
              : '[&>[data-slot=button]]:flex-none',
          )}
        >
          <Button size={size} icon={Check} onClick={() => void decide(true)}>
            {APPROVE_LABEL[action]}
          </Button>
          <Button
            size={size}
            variant={size === 'sm' ? 'secondary' : 'outline'}
            icon={Undo2}
            onClick={() => setSendingBack(true)}
          >
            Send back
          </Button>
          {reviewTicketId !== null && <ReviewButton ticketId={reviewTicketId} />}
        </div>
      )}
      {error && (
        <p className="mx-24 my-0 text-12/[normal] text-status-error-foreground" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * An approval's actions while pending, its outcome after: what a row with no card shows. The thread
 * panel passes `withReview={false}`: its row is two equal halves, and its card carries Review instead.
 */
export function ApprovalButtons({
  approval,
  withReview = true,
  fill = true,
}: {
  approval: Approval
  withReview?: boolean
  /** See `ApprovalDecision`: an Inbox row's pair does not split the width. */
  fill?: boolean
}) {
  return approval.status === 'pending' ? (
    <ApprovalDecision
      approvalId={approval.id}
      action={approval.action}
      reviewTicketId={withReview ? reviewTicketOfApproval(approval) : null}
      fill={fill}
    />
  ) : (
    <ApprovalOutcome approval={approval} />
  )
}

/** What a decided Approval reads as under the thread panel's card. */
export function ApprovalOutcome({ approval }: { approval: Approval }) {
  const approved = approval.status === 'approved'
  return (
    <div className="flex shrink-0 items-center gap-10">
      <Badge variant={approved ? 'success' : 'danger'}>{approved ? 'Approved' : 'Sent back'}</Badge>
      {approval.decisionReason && (
        <span className="text-12/[normal] text-muted-foreground">{approval.decisionReason}</span>
      )}
    </div>
  )
}
