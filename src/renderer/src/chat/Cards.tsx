import {
  CircleCheck,
  CircleDashed,
  CircleX,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitPullRequestArrow,
  Layers,
  type LucideIcon,
  MessagesSquare,
  Package,
  SquareKanban,
  Target,
  UserCheck,
} from 'lucide-react'
import { handoffBadge } from '../../../shared/review'
import { navigate } from '../chrome'
import { openReview } from '../review'
import { TestEvidenceCard } from '../testing'
import { cx } from '../ui'
import { ApprovalCard } from './ApprovalCard'
import { type MessageCard as Card, type ChipIcon, checksSummary, diffLabel } from './chat-view'
import { DigestCard } from './DigestCard'
import { PlanCard, QuestionsCard } from './PlanCard'
import { usePullRequestDetails } from './use-chat-data'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** The pill the members badge, the ticket counts and the repo badges share. */
const PILL =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-9 py-3 font-semibold'

/** The repo chip: the pill, in the mono face. */
const CHIP =
  'inline-flex items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-10 py-4 font-code font-normal text-11/[normal] [&_svg]:text-muted-foreground'

/** A card's own quiet action — Review, Reply — flat until the pointer is on it. */
const QUIET =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border-0 bg-transparent font-semibold text-12/[normal] text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/** One fact on the PR card: an icon and a word. */
const FACT = 'inline-flex shrink-0 items-center gap-6 whitespace-nowrap font-normal text-12/[normal]'

/** The rich card under a message: a target, a ticket's chips, a PR, an approval, or the daily digest. */
export function MessageCard(props: { card: Card; onOpenThread?: (() => void) | undefined }) {
  const { card } = props
  switch (card.kind) {
    case 'target':
      return <TargetCard card={card} />
    case 'chips':
      return <ChipRow chips={card.chips} />
    case 'pr':
      return <PrCard card={card} onOpenThread={props.onOpenThread} />
    case 'approval':
      return <ApprovalCard card={card} onOpenThread={props.onOpenThread} />
    case 'questions':
      return <QuestionsCard card={card} />
    case 'plan':
      return <PlanCard card={card} />
    case 'digest':
      return <DigestCard card={card} />
    case 'test':
      return <TestEvidenceCard run={card.run} ticketLabel={card.ticketLabel} agentName={card.agentName} />
  }
}

function TargetCard({ card }: { card: Extract<Card, { kind: 'target' }> }) {
  return (
    <section
      className="flex w-full flex-col rounded-sm border border-border bg-card"
      aria-label={`Target ${card.title}`}
    >
      <header className="flex items-center gap-8 border-border border-b px-14 py-11 text-foreground">
        <Target size={15} aria-hidden className="shrink-0" />
        {/* A target is often a whole sentence (T271): it wraps under itself rather than past the card. */}
        <span className="min-w-0 font-bold text-13/[normal] text-foreground [overflow-wrap:anywhere]">
          Target · {card.title}
        </span>
        <span className="shrink grow basis-0" />
        {card.due && (
          <span className="whitespace-nowrap font-normal text-11/[normal] text-muted-foreground">Due {card.due}</span>
        )}
      </header>
      <ul className="m-0 flex list-none flex-col gap-8 px-14 py-10">
        {card.epics.map((epic) => (
          <li key={epic.id} className="flex items-center gap-10 text-muted-foreground">
            <Layers size={14} aria-hidden className="shrink-0" />
            <span className={cx('min-w-0 font-semibold text-13/[normal] [overflow-wrap:anywhere]', SOFT)}>
              {epic.title}
            </span>
            <span className="shrink grow basis-0" />
            {epic.who.length > 0 && (
              <span className="whitespace-nowrap font-normal text-11/[normal] text-muted-foreground">
                {epic.who.join(', ')}
              </span>
            )}
            <span className={cx(PILL, SOFT, 'text-11/13')}>
              {epic.tickets} {epic.tickets === 1 ? 'ticket' : 'tickets'}
            </span>
          </li>
        ))}
      </ul>
      <footer className="flex items-center gap-10 whitespace-nowrap border-border border-t px-14 py-9 text-11/[normal] text-muted-foreground">
        <span>{card.foot}</span>
        <span className="shrink grow basis-0" />
        <button
          type="button"
          className={cx(QUIET, 'px-10 py-6')}
          onClick={() => navigate({ view: 'board', targetId: card.targetId })}
        >
          <SquareKanban size={14} aria-hidden />
          Open board
        </button>
      </footer>
    </section>
  )
}

const CHIP_ICON: Record<ChipIcon, LucideIcon> = { branch: GitBranch, repo: FolderGit2, stack: Package }

function ChipRow({ chips }: { chips: { icon: ChipIcon; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-8">
      {chips.map((chip) => {
        const Icon = CHIP_ICON[chip.icon]
        return (
          <span key={`${chip.icon}:${chip.label}`} className={cx(CHIP, SOFT)}>
            <Icon size={12} aria-hidden />
            {chip.label}
          </span>
        )
      })}
    </div>
  )
}

const CHECK_ICON = { passing: CircleCheck, pending: CircleDashed, failing: CircleX, none: CircleCheck }

function PrCard({
  card,
  onOpenThread,
}: {
  card: Extract<Card, { kind: 'pr' }>
  onOpenThread?: (() => void) | undefined
}) {
  const read = usePullRequestDetails(card.ticketId)
  const details = read && read.length > 0 ? read : null
  const checks = details && checksSummary(details)
  const ChecksIcon = CHECK_ICON[checks?.state ?? 'none']
  return (
    <section
      className="flex w-full flex-col rounded-sm border-muted-foreground border-l-2 bg-card"
      aria-label="Pull request"
    >
      {card.pullRequests.map((pr) => (
        <header key={pr.url} className="flex items-center gap-8 px-14 py-12 text-muted-foreground [&+&]:pt-0">
          <GitPullRequestArrow size={15} aria-hidden />
          <a
            className="min-w-0 shrink grow basis-0 font-semibold text-13/[normal] text-foreground no-underline hover:underline"
            href={pr.url}
            target="_blank"
            rel="noreferrer"
          >
            {pr.repo}
            {pr.number !== null && ` #${pr.number}`} — {pr.title}
          </a>
        </header>
      ))}
      {/* The facts wrap onto a second line rather than run out of the card in a narrow chat (T288). */}
      <div className="flex flex-wrap items-center gap-x-14 gap-y-8 px-14 pt-0 pb-12">
        {/*
          While the agents are still reviewing the card says so and offers no decision: the boss
          sees progress, not a request (T170, frame `F2HxCz`).
        */}
        {card.handoff && (
          <span
            className={cx(
              'inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-secondary px-9 py-2 font-semibold text-11/[normal]',
              card.handoff === 'ready' && 'text-status-warning-foreground',
              card.handoff === 'your_call' && 'text-status-error-foreground',
              card.handoff !== 'ready' && card.handoff !== 'your_call' && 'text-muted-foreground',
            )}
          >
            {handoffBadge(card.handoff)}
          </span>
        )}
        {card.round && (
          <span className={cx(FACT, 'text-muted-foreground')}>
            <MessagesSquare size={13} aria-hidden />
            {card.round}
          </span>
        )}
        {details && (
          <span className={cx(FACT, 'text-muted-foreground')}>
            <FileDiff size={13} aria-hidden />
            {diffLabel(details)}
          </span>
        )}
        {checks && (
          <span
            className={cx(FACT, checks.state === 'failing' ? 'text-status-error-foreground' : 'text-muted-foreground')}
          >
            <ChecksIcon size={13} aria-hidden />
            {checks.label}
          </span>
        )}
        {card.reviewer && (
          <span className={cx(FACT, 'text-muted-foreground')}>
            <UserCheck size={13} aria-hidden />
            {card.reviewer}
          </span>
        )}
        <span className="shrink grow basis-0" />
        <button
          type="button"
          className={cx(QUIET, 'px-10 py-5')}
          onClick={() => openReview({ ticketId: card.ticketId })}
        >
          <FileDiff size={13} aria-hidden />
          Review
        </button>
        {onOpenThread && (
          <button type="button" className={cx(QUIET, 'px-10 py-5')} onClick={onOpenThread}>
            <MessagesSquare size={13} aria-hidden />
            {card.replies === 0 ? 'Reply' : `${card.replies} ${card.replies === 1 ? 'reply' : 'replies'}`}
          </button>
        )}
      </div>
    </section>
  )
}
