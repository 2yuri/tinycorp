import { CircleCheck, CircleDashed, CircleMinus, CircleX, MessagesSquare, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Approval, AUTONOMY_LABEL, AUTONOMY_LEVELS } from '../../../shared/approvals'
import type { AttachmentSource } from '../../../shared/attachments'
import type { PullRequestCheck, PullRequestDetails } from '../../../shared/code'
import type { Mentionable, Message } from '../../../shared/domain/chat'
import { draftKeys } from '../../../shared/drafts'
import { reviewTicketOfApproval } from '../../../shared/review/review-entry'
import { ReviewButton } from '../review'
import { Badge, cx, EmptyState } from '../ui'
import { ApprovalButtons, ApprovalDetailCard } from './ApprovalCard'
import { Composer, type SlashComposer } from './Composer'
import {
  autonomyNotice,
  type ChatData,
  formatDuration,
  mergeBadge,
  pullRequestsOfApproval,
  threadTitle,
  ticketOfApproval,
} from './chat-view'
import { type Refs, ReplyRow } from './Messages'
import { useAutonomyLevel, usePullRequestDetails } from './use-chat-data'
import { useStickToBottom } from './use-stick-to-bottom'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** One of the panel's flat icon buttons. */
const TOOL =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-muted-foreground hover:not-disabled:text-foreground disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'

/** A quiet button in the autonomy notice. */
const AUTONOMY_BUTTON =
  'cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-bold text-11/[normal] text-muted-foreground hover:text-foreground'

/** The PR state badge, reached through the kit: the pill's padding, and chat's soft ink on its label. */
const STATE = `px-9 py-3 bg-secondary text-11/[normal] [&_[data-slot=badge-label]]:text-[#cbd5e1] [[data-theme='light']_&]:[&_[data-slot=badge-label]]:text-secondary-foreground`

const approvals = window.tinyCorp.approvals

/** The right-hand panel: a thread with its approval card and actions, replies and a reply box. */
export function ThreadPanel(props: {
  thread: Message[]
  data: ChatData
  people: Mentionable[]
  refs: Refs
  /** The slash commands the reply box runs, on this thread (decision 37). */
  slash?: SlashComposer | undefined
  onReply(rootId: number, text: string, attachments: AttachmentSource[]): Promise<boolean>
  onClose(): void
  /** The message a notification opened the thread on: it scrolls into view and is marked (T287). */
  focusId?: number | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const focusId = props.focusId ?? null
  const hasFocus = focusId !== null && props.thread.some((m) => m.id === focusId)
  useStickToBottom(scroller, content, props.thread.at(-1)?.id ?? null, hasFocus)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh jump scrolls again even when the reply was already drawn.
  useEffect(() => {
    if (!hasFocus) return
    void scroller.current?.querySelector(`[data-message-id="${focusId}"]`)?.scrollIntoView({ block: 'center' })
  }, [focusId, hasFocus])
  const root = props.thread[0]
  if (!root) {
    return (
      <aside className="flex w-368 shrink-0 flex-col border-border border-l bg-card" aria-label="Thread">
        <PanelHead title="Thread" origin="Nothing open" onClose={props.onClose} />
        <div className="flex min-h-0 shrink grow basis-0 flex-col justify-center gap-14 overflow-auto p-16">
          <EmptyState
            icon={MessagesSquare}
            title="No thread open"
            body="Open a message’s replies to read and answer them here."
          />
        </div>
      </aside>
    )
  }
  const approval = props.data.approvals.get(root.id)
  const replies = props.thread.slice(1)
  const heading = threadTitle(root, approval, props.data)
  return (
    <aside className="flex w-368 shrink-0 flex-col border-border border-l bg-card" aria-label={heading.title}>
      <PanelHead title={heading.title} origin={heading.origin} onClose={props.onClose} />
      <div ref={scroller} className="flex min-h-0 shrink grow basis-0 flex-col overflow-auto p-16">
        <div ref={content} className="flex shrink-0 flex-col gap-14">
          {approval ? (
            <ApprovalBlock key={approval.id} approval={approval} data={props.data} />
          ) : (
            <ReplyRow
              message={root}
              data={props.data}
              people={props.people}
              refs={props.refs}
              focused={focusId === root.id}
            />
          )}
          <div className="flex shrink-0 items-center gap-10 whitespace-nowrap pt-6 font-bold text-11/[normal] text-muted-foreground tracking-[0.6px]">
            <span>
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </span>
            <span className="h-1 shrink grow basis-0 bg-border" />
          </div>
          {replies.map((m) => (
            <ReplyRow
              key={m.id}
              message={m}
              data={props.data}
              people={props.people}
              refs={props.refs}
              focused={focusId === m.id}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 px-16 pt-0 pb-16">
        <Composer
          key={root.id}
          variant="reply"
          draftKey={draftKeys.thread(root.id)}
          placeholder="Reply in thread…"
          people={props.people}
          refs={props.refs}
          slash={props.slash}
          onSend={(text, attachments) => props.onReply(root.id, text, attachments)}
        />
      </div>
    </aside>
  )
}

function PanelHead(props: { title: string; origin: string; onClose(): void }) {
  return (
    <header className="flex min-h-64 shrink-0 items-center gap-10 border-border border-b px-16 py-10">
      <div className="flex min-w-0 shrink grow basis-0 flex-col gap-1">
        <strong className="font-bold text-14/[normal] text-foreground [overflow-wrap:anywhere]">{props.title}</strong>
        <span className="font-normal text-11/[normal] text-muted-foreground [overflow-wrap:anywhere]">
          {props.origin}
        </span>
      </div>
      <button type="button" className={TOOL} aria-label="Close thread" title="Close thread" onClick={props.onClose}>
        <X size={17} aria-hidden />
      </button>
    </header>
  )
}

/** The PR card (or the generic approval card), the autonomy notice and Approve / Send back. */
export function ApprovalBlock({ approval, data }: { approval: Approval; data: ChatData }) {
  const ticketId = ticketOfApproval(approval)
  const details = usePullRequestDetails(ticketId)
  const ticket = data.board?.tickets.find((t) => t.id === ticketId)
  const pullRequests = pullRequestsOfApproval(approval, data)
  const reviewTicketId = reviewTicketOfApproval(approval)
  return (
    <>
      {pullRequests.length > 0 ? (
        pullRequests.map((pr) => (
          <PrDetail
            key={pr.url}
            repo={data.repos.find((r) => r.id === pr.repoId)?.name ?? 'removed repo'}
            number={pr.number}
            url={pr.url}
            title={ticket?.title ?? approval.subject}
            details={details?.find((d) => d.url === pr.url) ?? null}
            loading={details === null}
            reviewTicketId={reviewTicketId}
          />
        ))
      ) : (
        <ApprovalDetailCard approval={approval} data={data} />
      )}
      <AutonomyNotice action={approval.action} />
      <ApprovalButtons approval={approval} withReview={false} />
    </>
  )
}

function PrDetail(props: {
  repo: string
  number: number | null
  url: string
  title: string
  details: PullRequestDetails | null
  loading: boolean
  /** The ticket whose diff the head's Review opens; null leaves it out. */
  reviewTicketId: number | null
}) {
  const { details } = props
  const badge = details ? mergeBadge(details) : null
  return (
    <section
      className="flex shrink-0 flex-col gap-10 rounded-sm border border-border bg-card p-14"
      aria-label="Pull request details"
    >
      <div className="flex flex-wrap items-center gap-8">
        <span
          className={cx(
            'inline-flex min-w-0 max-w-full items-center gap-6 rounded-full bg-secondary px-9 py-3 font-semibold text-11/[normal] [overflow-wrap:anywhere]',
            SOFT,
          )}
        >
          {props.repo}
        </span>
        {props.number !== null && (
          <a
            className="font-code text-11/[normal] text-muted-foreground no-underline hover:text-foreground hover:underline"
            href={props.url}
            target="_blank"
            rel="noreferrer"
          >
            #{props.number}
          </a>
        )}
        {props.reviewTicketId !== null && <ReviewButton ticketId={props.reviewTicketId} />}
        <span className="shrink grow basis-0" />
        {badge && (
          <Badge variant={badge.variant} className={STATE}>
            {badge.label}
          </Badge>
        )}
      </div>
      <div className="font-semibold text-14/20 text-foreground [overflow-wrap:anywhere]">
        {details?.title || props.title}
      </div>
      <div className="font-code text-11/17 text-muted-foreground [overflow-wrap:anywhere]">
        {details
          ? `${details.head} → ${details.base} · +${details.additions} −${details.deletions} · ${details.changedFiles} ${
              details.changedFiles === 1 ? 'file' : 'files'
            }`
          : props.loading
            ? 'Asking the forge…'
            : 'The forge did not answer'}
      </div>
      {details && (
        <>
          <div className="h-1 w-full flex-none bg-border" />
          {details.checks.length === 0 ? (
            <div className="flex items-center gap-8 text-muted-foreground [&>svg]:shrink-0">
              <CircleMinus size={14} aria-hidden />
              <span className={cx('min-w-0 text-12/[normal] [overflow-wrap:anywhere]', SOFT)}>No checks reported</span>
            </div>
          ) : (
            details.checks.map((check, i) => <CheckRow key={`${check.name}-${i}`} check={check} />)
          )}
        </>
      )}
    </section>
  )
}

const CHECK_ICON = { passing: CircleCheck, failing: CircleX, pending: CircleDashed, skipped: CircleMinus }

function CheckRow({ check }: { check: PullRequestCheck }) {
  const Icon = CHECK_ICON[check.state]
  return (
    <div
      className={cx(
        'flex items-center gap-8 text-muted-foreground [&>svg]:shrink-0',
        check.state === 'failing' && '[&_svg]:text-status-error-foreground',
      )}
    >
      <Icon size={14} aria-hidden />
      <span className={cx('min-w-0 shrink text-12/[normal] [overflow-wrap:anywhere]', SOFT)}>
        {check.workflow ? `${check.name} · ${check.workflow}` : check.name}
      </span>
      <span className="shrink grow basis-0" />
      <span className="whitespace-nowrap font-code text-11/[normal] text-muted-foreground">
        {check.state === 'pending'
          ? 'running'
          : check.state === 'skipped'
            ? 'skipped'
            : formatDuration(check.durationMs)}
      </span>
    </div>
  )
}

function AutonomyNotice({ action }: { action: Approval['action'] }) {
  const level = useAutonomyLevel()
  const [changing, setChanging] = useState(false)
  if (!level) return null
  return (
    <div className="flex shrink-0 items-center gap-9 rounded-sm bg-secondary px-12 py-10 text-muted-foreground [&_svg]:shrink-0">
      <ShieldCheck size={15} aria-hidden />
      {changing ? (
        <fieldset className="flex shrink grow basis-0 flex-wrap gap-4" aria-label="Autonomy level">
          {AUTONOMY_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === level}
              className={cx(AUTONOMY_BUTTON, 'rounded-[6px] px-6 py-2', l === level && 'bg-card text-foreground')}
              onClick={() => {
                setChanging(false)
                if (l !== level) void approvals.setLevel(l)
              }}
            >
              {AUTONOMY_LABEL[l]}
            </button>
          ))}
        </fieldset>
      ) : (
        <span className="shrink grow basis-0 font-semibold text-12/17">
          {AUTONOMY_LABEL[level]} — {autonomyNotice(level, action)}
        </span>
      )}
      <button type="button" className={AUTONOMY_BUTTON} onClick={() => setChanging(!changing)}>
        {changing ? 'Cancel' : 'Change'}
      </button>
    </div>
  )
}
