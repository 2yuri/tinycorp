import {
  AtSign,
  CheckCheck,
  CircleCheck,
  ClipboardList,
  Eye,
  GitPullRequest,
  Hand,
  Hourglass,
  type LucideIcon,
  Mail,
  MessagesSquare,
  PanelRight,
  Play,
  Search,
} from 'lucide-react'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { reviewTicketOfApproval } from '../../../shared/review/review-entry'
import { ViewHeader } from '../chrome'
import { PersonAvatar } from '../people'
import { openReview } from '../review'
import { openTesting } from '../testing'
import { cx, EmptyState } from '../ui'
import { ApprovalButtons } from './ApprovalCard'
import type { ChannelHeader, ChatData } from './chat-view'
import {
  FILTER_LABEL,
  filterCounts,
  INBOX_FILTERS,
  type InboxFilter,
  type InboxIcon,
  type InboxRow,
  inboxGroups,
  rowTarget,
  rowTerminal,
} from './inbox-view'
import { PlanDecision } from './PlanCard'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as `--chat-soft` and
 * `--chat-inbox-soft`, two custom properties with the same value and the same
 * `[data-theme='light']` override, and this is that pair, per element.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** The members badge in the shell header, beside the Inbox title. */
const BADGE =
  'inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-11 py-5 font-semibold text-12/[normal]'

/** One of the top bar's square icon buttons. */
const TOOL =
  'relative flex size-36 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-transparent p-0 text-muted-foreground disabled:cursor-default focus-visible:shadow-focus focus-visible:outline-none'
const TOOL_ON = 'bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] text-foreground'
const TOOL_HOVER =
  'hover:not-disabled:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:not-disabled:text-foreground'

/** A card's own quiet action, flat until the pointer is on it. */
const QUIET =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-sm border-0 bg-transparent px-10 py-5 font-semibold text-12/[normal] text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'

/**
 * Fills the shell's content header for the Inbox, as the channel header does for a channel: the
 * count of what is unread, what the list is, and the thread panel toggle. The Inbox has no members
 * and nothing to pin.
 */
export function InboxHeader(props: { header: ChannelHeader; panelOpen: boolean; onTogglePanel(): void }) {
  return (
    <ViewHeader
      title={props.header.title}
      badge={<span className={cx(BADGE, SOFT)}>{props.header.members}</span>}
      subtitle={props.header.topic}
    >
      <span className="flex items-center gap-14">
        {/* Searching the Inbox has no engine behind it yet: drawn as designed, inert. */}
        <button
          type="button"
          className={cx(TOOL, TOOL_HOVER)}
          aria-label="Search the Inbox"
          title="Search the Inbox"
          disabled
        >
          <Search size={18} aria-hidden />
        </button>
        <button
          type="button"
          className={cx(TOOL, TOOL_HOVER, props.panelOpen && TOOL_ON)}
          aria-label={props.panelOpen ? 'Hide thread panel' : 'Show thread panel'}
          aria-pressed={props.panelOpen}
          title="Thread panel"
          onClick={props.onTogglePanel}
        >
          <PanelRight size={18} aria-hidden />
        </button>
      </span>
    </ViewHeader>
  )
}

/**
 * `Run it` on an Inbox row (frame `YatUW`, card d): it starts the ticket's first runnable app in
 * its worktree and opens the test screen. An app that will not start says so on the screen itself,
 * which is where the boss is a moment later.
 */
async function runIt(ticketId: number): Promise<void> {
  const runnable = await window.tinyCorp.tests.runnable(ticketId)
  const first = runnable.ok ? runnable.value.find((repo) => repo.run?.state !== 'running') : undefined
  if (first) await window.tinyCorp.tests.startApp(ticketId, first.repoId)
  openTesting({ ticketId })
}

const KIND_ICON: Record<InboxIcon, LucideIcon> = {
  asking: Hand,
  approval: GitPullRequest,
  plan: ClipboardList,
  waiting: Hourglass,
  dm: Mail,
  mention: AtSign,
  thread: MessagesSquare,
  decided: CircleCheck,
}

/**
 * The boss's Inbox in place of a channel's messages (decision 43): filter chips, `Mark all read`,
 * and the rows grouped Today / Earlier. Clicking a row opens its thread beside the list.
 */
export function InboxList(props: {
  items: BossInboxItem[]
  data: ChatData
  filter?: InboxFilter
  onFilter?(filter: InboxFilter): void
  /** The row whose thread the panel shows, so it reads as selected. */
  openThread: number | null
  /** The row the boss clicked: where it lives, and the row itself, whose conversation opens (T251). */
  onOpen(target: { channelId: string; threadId: number }, item: BossInboxItem): void
  /**
   * An `asking` row: open this Employee's drawer on the Terminal tab, which is where the boss
   * answers (T165). Without it those rows are drawn and do nothing.
   */
  onOpenTerminal?: ((employeeId: string) => void) | undefined
  onMarkAllRead?(): void
  /**
   * `compact` is the boss's desk (T71): the same rows, without the filters, the day groups and
   * the empty state, which the panel around them owns.
   */
  variant?: 'full' | 'compact'
}) {
  const filter = props.filter ?? 'all'
  const counts = filterCounts(props.items)
  const groups = inboxGroups(props.items, props.data, filter)
  const onFilter = props.onFilter
  const onMarkAllRead = props.onMarkAllRead
  if (props.variant === 'compact') {
    return (
      <section className="flex min-h-0 flex-none flex-col gap-16 overflow-visible p-0" aria-label="Unread for you">
        {groups.flatMap((group) =>
          group.rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              data={props.data}
              open={props.openThread === row.item.threadId}
              onOpen={props.onOpen}
              onOpenTerminal={props.onOpenTerminal}
              compact
            />
          )),
        )}
      </section>
    )
  }
  return (
    <section
      className="flex min-h-0 shrink grow basis-0 flex-col gap-4 overflow-auto px-20 pt-14 pb-20"
      aria-label="Inbox"
    >
      <div className="flex w-full shrink-0 items-center gap-8 pb-14">
        {INBOX_FILTERS.map((chip) => (
          <button
            key={chip}
            type="button"
            className={cx(
              'inline-flex shrink-0 cursor-pointer items-center gap-6 whitespace-nowrap rounded-full border-0 px-11 py-5 font-semibold text-12/[normal]',
              filter === chip
                ? 'bg-primary text-primary-foreground'
                : cx(SOFT, 'bg-secondary hover:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground))]'),
            )}
            aria-pressed={filter === chip}
            onClick={() => onFilter?.(chip)}
          >
            <span>{FILTER_LABEL[chip]}</span>
            <span
              className={cx('text-11/[normal]', filter === chip ? 'text-primary-foreground' : 'text-muted-foreground')}
            >
              {counts[chip]}
            </span>
          </button>
        ))}
        <span className="shrink grow basis-0" />
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-6 whitespace-nowrap rounded-sm border-0 bg-transparent px-8 py-5 font-semibold text-12/[normal] text-muted-foreground hover:text-foreground"
          onClick={() => onMarkAllRead?.()}
        >
          <CheckCheck size={14} aria-hidden />
          Mark all read
        </button>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="Nothing waiting on you"
          body="Mentions, replies in your threads, approvals and direct messages land here."
        />
      ) : (
        groups.map((group) => (
          <div key={group.label} className="flex w-full shrink-0 flex-col gap-4 pt-2">
            <h3 className="mx-0 mt-0 mb-0 px-0 pt-6 pb-2 font-bold text-11/[normal] text-muted-foreground uppercase tracking-[0.5px]">
              {group.label}
            </h3>
            {group.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                data={props.data}
                open={props.openThread === row.item.threadId}
                onOpen={props.onOpen}
                onOpenTerminal={props.onOpenTerminal}
              />
            ))}
          </div>
        ))
      )}
    </section>
  )
}

function Row(props: {
  row: InboxRow
  data: ChatData
  open: boolean
  onOpen(target: { channelId: string; threadId: number }, item: BossInboxItem): void
  onOpenTerminal?: ((employeeId: string) => void) | undefined
  /** The desk's rows: the frame draws them one step tighter, avatar included. */
  compact?: boolean
}) {
  const { row } = props
  const Icon = KIND_ICON[row.icon]
  const terminalFor = rowTerminal(row.item)
  return (
    <div
      className={cx(
        'flex w-full shrink-0 flex-col rounded-md border border-transparent',
        props.open || row.approval
          ? 'border-border bg-card'
          : 'hover:bg-[color-mix(in_srgb,var(--card)_60%,transparent)]',
      )}
    >
      <button
        type="button"
        className={cx(
          'flex w-full cursor-pointer items-start border-0 bg-transparent text-left',
          props.compact ? 'gap-10 p-8' : 'gap-12 px-14 py-12',
          row.approval && (props.compact ? 'pb-2' : 'pb-4'),
        )}
        aria-current={props.open ? 'true' : undefined}
        onClick={() =>
          terminalFor === null ? props.onOpen(rowTarget(row.item), row.item) : props.onOpenTerminal?.(terminalFor)
        }
      >
        {row.icon === 'waiting' ? (
          <span
            className="inline-flex size-32 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground"
            aria-hidden
          >
            <Hourglass size={15} />
          </span>
        ) : (
          <PersonAvatar id={row.fromId} name={row.who} people={props.data} size={props.compact ? 26 : 32} ring />
        )}
        <span className="flex min-w-0 shrink grow basis-0 flex-col gap-4">
          <span className={cx('flex w-full items-center', props.compact ? 'gap-7' : 'gap-8')}>
            <span
              className={cx(
                'whitespace-nowrap font-semibold text-foreground',
                props.compact ? 'text-12-5/[normal]' : 'text-13/[normal]',
              )}
            >
              {row.who}
            </span>
            <span
              className={cx(
                'inline-flex shrink-0 items-center gap-5 whitespace-nowrap rounded-full bg-secondary px-7 py-2 font-semibold text-10-5/[normal]',
                SOFT,
                row.icon === 'approval' || row.icon === 'asking'
                  ? '[&_svg]:text-brand-warning'
                  : row.icon === 'decided'
                    ? '[&_svg]:text-brand-success'
                    : '[&_svg]:text-muted-foreground',
              )}
            >
              <Icon size={11} aria-hidden />
              {row.kindLabel}
            </span>
            <span
              className={cx(
                'whitespace-nowrap text-muted-foreground',
                props.compact ? 'text-11-5/[normal]' : 'text-12/[normal]',
              )}
            >
              {row.where}
            </span>
            <span className="shrink grow basis-0" />
            <span className="shrink-0 whitespace-nowrap text-11/[normal] text-muted-foreground">{row.time}</span>
            {row.unread && (
              <span
                className={cx('shrink-0 rounded-full bg-primary', props.compact ? 'size-7' : 'size-8')}
                role="img"
                aria-label="Unread"
              />
            )}
          </span>
          <span
            className={cx(
              props.compact
                ? 'overflow-visible text-clip whitespace-normal text-12-5/18'
                : 'overflow-hidden text-ellipsis whitespace-nowrap text-13/19',
              SOFT,
            )}
          >
            {row.excerpt}
          </span>
        </span>
      </button>
      {(row.approval || row.plan || row.reviewTicketId !== null || row.test) && (
        <div className={cx('flex flex-col gap-8', props.compact ? 'pt-0 pr-8 pb-8 pl-44' : 'pt-2 pr-14 pb-12 pl-58')}>
          {/* A ticket waiting on the boss's own test: Run it starts the app and opens the script. */}
          {row.test && (
            <>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-6 rounded-sm border-0 bg-primary px-11 py-5 font-semibold text-12/[normal] text-primary-foreground"
                onClick={() => void runIt(row.test!.ticketId)}
              >
                <Play size={13} aria-hidden />
                Run it
              </button>
              <button type="button" className={QUIET} onClick={() => openTesting({ ticketId: row.test!.ticketId })}>
                <Eye size={13} aria-hidden />
                {row.test.agentVerdict ? 'See the evidence' : 'Open the script'}
              </button>
            </>
          )}
          {row.approval && <ApprovalButtons approval={row.approval} fill={false} />}
          {/* A drafted plan is decided from the row itself, the way an Approval is (T233). */}
          {row.plan && (
            <div className="flex flex-wrap items-center gap-10">
              <PlanDecision planId={row.plan.id} version={row.plan.version} replan={row.plan.status === 'replan'} />
            </div>
          )}
          {/* A merge's own buttons already carry the diff (T82); do not offer it twice. */}
          {row.reviewTicketId !== null && !(row.approval && reviewTicketOfApproval(row.approval) !== null) && (
            <button type="button" className={QUIET} onClick={() => openReview({ ticketId: row.reviewTicketId! })}>
              <GitPullRequest size={13} aria-hidden />
              Review
            </button>
          )}
        </div>
      )}
    </div>
  )
}
