import {
  ArrowRight,
  CircleHelp,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Link2,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import type { Epic, Ticket } from '../../../shared/domain/board'
import { type PlanChipTone, planChip } from '../../../shared/planning/planning'
import { repoLine } from '../../../shared/repos/repo-line'
import type { SecurityTone } from '../../../shared/review/security'
import type { TestChipTone } from '../../../shared/testing'
import { openReview } from '../review'
import { openTesting } from '../testing'
import { Avatar, type AvatarPerson, cx } from '../ui'
import {
  type BoardFacts,
  cardFacts,
  epicPlanOf,
  linkChipsOf,
  planLabel,
  planQuestions,
  STATUS_LABEL,
  securityChipOf,
  type TicketStatus,
  testChipOf,
  ticketLabel,
  ticketStatus,
} from './board-model'
import { EpicMark } from './EpicMark'
import { LabelChip, PriorityFlag } from './TicketExtras'

export type CardView = 'full' | 'mini'

/**
 * A card is opened with the mouse and with the keyboard. It is not a `button` — it carries buttons
 * of its own, and a button inside a button is not markup — so it is a focusable row that answers
 * Enter and Space, and only when the key landed on the card itself rather than on a chip inside it.
 */
function openOnKey(onOpen: (() => void) | undefined) {
  if (!onOpen) return undefined
  return (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
}

export interface TicketCardProps {
  ticket: Ticket
  facts: BoardFacts
  /** The whole board's tickets, to say what a card waits on and what waits on it; no chips without. */
  tickets?: readonly Ticket[] | undefined
  /** The epic the ticket is in, beside its id (T274); a ticket in none keeps the slate dot. */
  epic?: Pick<Epic, 'title' | 'color'> | null | undefined
  view: CardView
  repoName(id: string): string
  employeeName(id: string): string
  /** The assignee's character and accent; null for an Employee who is gone. */
  employeePerson(id: string): AvatarPerson | null
  dragging?: boolean
  onOpen?(): void
  onDragStart?(event: DragEvent<HTMLLIElement>): void
  onDragEnd?(): void
}

/** A board card (design/html/board.html: Board › column › Cards › card). */
/*
 * The card and its chips. A state that overrides a property is chosen here rather than appended:
 * two utilities on one property are settled by the compiled sheet's order, not by the `className`.
 */
/** The frame's 12px padding counts the 1px stroke, so the padding is 11. */
const CARD =
  'flex shrink-0 cursor-pointer flex-col rounded-sm border border-border bg-card hover:border-[color-mix(in_srgb,var(--muted-foreground)_60%,var(--border))] focus-visible:shadow-focus focus-visible:outline-none'
const CARD_VIEW: Record<'full' | 'mini', string> = { full: 'gap-9 p-11', mini: 'gap-4 px-9 py-7' }
/** The status badge at the foot, and the dot that says which status it is. */
const STATUS =
  'inline-flex shrink-0 items-center gap-6 rounded-full bg-secondary px-8 py-3 text-10-5/[inherit] font-semibold whitespace-nowrap text-soft-ink-adaptive'
const STATUS_DOT: Record<TicketStatus, string> = {
  working: 'bg-brand-success',
  waiting: 'bg-brand-warning',
  blocked: 'bg-brand-danger',
  review: 'bg-brand-text-muted',
  merged: 'bg-brand-text-muted',
}
/** The plan chip. `approved` drops the wash and reads as a line of its own. */
const PLAN = 'flex items-center gap-7 text-11-5/[inherit] text-[var(--chat-soft,var(--muted-foreground))]'
const PLAN_TONE: Record<PlanChipTone, string> = {
  asking: 'rounded-sm bg-muted px-8 py-5',
  answered: 'rounded-sm bg-muted px-8 py-5',
  waiting: 'rounded-sm bg-muted px-8 py-5',
  drafting: 'rounded-sm bg-muted px-8 py-5',
  replan: 'rounded-sm bg-muted px-8 py-5',
  approved: 'rounded-sm py-5 pr-8 pl-0',
}
const PLAN_DOT: Record<PlanChipTone, string> = {
  asking: 'bg-brand-warning',
  // Answers sent reads as work in flight, never as the approved green (T233).
  answered: 'bg-brand-primary',
  waiting: 'bg-brand-warning',
  replan: 'bg-brand-warning',
  drafting: 'bg-brand-primary',
  approved: 'bg-brand-success',
}
/** `Step 2 of 5` while the agent works, `Iris 4/4` once it has handed the test over. */
const STEP =
  'inline-flex shrink-0 items-center gap-4 rounded-full bg-muted px-7 py-2 text-11/[inherit] font-semibold text-muted-foreground'
/**
 * The ticket's repos as one line — `banking, core-banking-usd, payment, … +107` — rather than a chip
 * each: a ticket can touch every repo a Company has (T283, T285). The drawer lists them all.
 */
function CardRepos({ names }: { names: string[] }) {
  const line = repoLine(names)
  return (
    <span
      data-slot="card-repos"
      title={line.all}
      className="inline-flex w-full min-w-0 items-center gap-5 whitespace-nowrap font-code font-normal text-10-5/[inherit] text-soft-ink-adaptive [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      <FolderGit2 size={11} aria-hidden />
      <span className="min-w-0 overflow-hidden text-ellipsis">{line.text}</span>
      {line.more > 0 && <span className="shrink-0 font-bold text-foreground">+{line.more}</span>}
    </span>
  )
}

/** `Blocked by TC-138` and `Blocks TC-150` (frame `IziV6`): outlined, where a repo chip is filled. */
const LINK =
  'inline-flex max-w-full items-center gap-5 whitespace-nowrap rounded-full border border-border bg-card px-7 py-2 text-10-5/[inherit] font-normal text-muted-foreground [&_svg]:shrink-0'
/** Who holds the ticket; unclaimed reads muted. */
const WHO = 'overflow-hidden text-ellipsis whitespace-nowrap text-11/[inherit] font-semibold'
/** The test chip, one line under the plan chip's place. */
const TEST =
  'flex w-full cursor-pointer items-center gap-7 rounded-sm border-0 bg-muted px-8 py-5 text-left text-11-5/[inherit] text-[var(--chat-soft,var(--muted-foreground))]'
const TEST_DOT: Record<TestChipTone, string> = {
  agent: 'bg-brand-primary',
  you: 'bg-brand-warning',
  failed: 'bg-brand-danger',
  passed: 'bg-brand-success',
}
/** The security badge, the test chip's own row with a shield in place of the dot (T241). */
const SECURITY =
  'flex w-full cursor-pointer items-center gap-7 rounded-sm border-0 bg-muted px-8 py-5 text-left text-11-5/[inherit] text-[var(--chat-soft,var(--muted-foreground))]'
const SECURITY_ICON: Record<SecurityTone, string> = {
  reading: 'text-brand-primary',
  blocked: 'text-brand-danger',
  findings: 'text-brand-warning',
  clear: 'text-brand-success',
  overridden: 'text-muted-foreground',
}

export function TicketCard(props: TicketCardProps) {
  const { ticket, facts, view } = props
  const status = ticketStatus(ticket, facts)
  const { worktree, pullRequests, canReview } = cardFacts(ticket, facts)
  const done = ticket.subtasks.filter((s) => s.done).length
  const plan = planLabel(ticket, facts, props.employeeName)
  const questions = planQuestions(ticket, facts)
  const test = testChipOf(ticket, facts, props.employeeName)
  const security = securityChipOf(ticket, facts, props.employeeName)
  const assignee = ticket.assigneeId ? props.employeeName(ticket.assigneeId) : null
  const assigneePerson = ticket.assigneeId ? props.employeePerson(ticket.assigneeId) : null
  const links = linkChipsOf(ticket, props.tickets ?? [])
  const codes = (ids: number[]) => ids.map((id) => ticketLabel(id, facts))

  return (
    <li
      data-ticket={ticket.id}
      data-ui="TicketCard"
      className={cx(
        CARD,
        CARD_VIEW[view],
        // A ticket that waits is drawn faded, as a Done one is: nobody picks it up yet (T266).
        (ticket.column === 'done' || links.waitsOn.length > 0) && 'opacity-72',
        props.dragging && 'opacity-40',
      )}
      data-waits={links.waitsOn.length > 0 || undefined}
      draggable
      tabIndex={props.onOpen ? 0 : undefined}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onClick={props.onOpen}
      onKeyDown={openOnKey(props.onOpen)}
      title={ticket.blocked ? `Blocked: ${ticket.blockedReason || 'no reason given'}` : undefined}
    >
      <div className="flex items-center gap-8">
        <span className="whitespace-nowrap font-code font-normal text-11/[inherit] text-muted-foreground">
          {ticketLabel(ticket.id, facts)}
        </span>
        <span className="flex-[1_1_0]" />
        <PriorityFlag priority={ticket.priority} />
        {/* How far the planner got with the boss, where a worked ticket shows its PR (T171). */}
        {questions && (
          <span
            className="inline-flex items-center gap-4 text-11/[inherit] text-muted-foreground"
            title="Questions answered"
          >
            <CircleHelp size={12} aria-hidden />
            {questions}
          </span>
        )}
        {/* The card itself opens the editor; this chip goes straight to the Review screen. */}
        {(pullRequests.length > 0 || canReview) && (
          <button
            type="button"
            className={cx(
              'inline-flex cursor-pointer items-center gap-4 whitespace-nowrap border-0 bg-transparent p-0 text-11/[inherit] text-muted-foreground hover:text-foreground',
              pullRequests.length === 0 ? 'font-[inherit] font-semibold' : 'font-code font-normal',
            )}
            title={
              pullRequests.length > 0
                ? `Review ${pullRequests.map((n) => `#${n}`).join(', ')}`
                : 'Review this ticket’s diff'
            }
            onClick={(event) => {
              event.stopPropagation()
              openReview({ ticketId: ticket.id })
            }}
          >
            {pullRequests.length > 0 ? (
              <>
                <GitPullRequest size={12} aria-hidden />
                <span>
                  #{pullRequests[0]}
                  {pullRequests.length > 1 && ` +${pullRequests.length - 1}`}
                </span>
              </>
            ) : (
              <>
                {/* A ticket with no PR still has a branch to read: the diff is the whole point. */}
                <FileDiff size={12} aria-hidden />
                <span>Review</span>
              </>
            )}
          </button>
        )}
        {/* The epic's own dot and title (T274, frame `RIko3`); a ticket in no epic keeps the slate dot. */}
        {props.epic ? (
          <EpicMark epic={props.epic} className="text-11/[inherit]" />
        ) : (
          <span className="size-7 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="wrap-anywhere font-medium text-13-5/19 text-foreground">{ticket.title}</div>
      {view === 'full' && plan && (
        <div className={cx(PLAN, PLAN_TONE[plan.tone])}>
          <span className={cx('size-6 rounded-full', PLAN_DOT[plan.tone])} aria-hidden />
          {plan.text}
        </div>
      )}
      {view === 'full' &&
        (ticket.repos.length > 0 ||
          worktree ||
          ticket.labels.length > 0 ||
          links.waitsOn.length > 0 ||
          links.blocks.length > 0) && (
          <div className="flex flex-wrap items-center gap-6">
            {ticket.repos.length > 0 && <CardRepos names={ticket.repos.map(props.repoName)} />}
            {worktree && (
              <span className="inline-flex max-w-full items-center gap-5 whitespace-nowrap rounded-full bg-secondary px-8 py-3 font-code font-normal text-10-5/[inherit] text-soft-ink-adaptive [&_span]:overflow-hidden [&_span]:text-ellipsis [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
                <GitBranch size={11} aria-hidden />
                <span>{worktree}</span>
              </span>
            )}
            {links.waitsOn.length > 0 && (
              <LinkChip
                ui="BlockedByChip"
                icon={<Link2 size={11} aria-hidden />}
                label="Blocked by"
                codes={codes(links.waitsOn)}
              />
            )}
            {links.blocks.length > 0 && (
              <LinkChip
                ui="BlocksChip"
                icon={<ArrowRight size={11} aria-hidden />}
                label="Blocks"
                codes={codes(links.blocks)}
              />
            )}
            {ticket.labels.map((label) => (
              <LabelChip key={label} label={label} size="sm" />
            ))}
          </div>
        )}
      {/* One chip line, between the repos and the assignee: who holds the test (`YatUW`). */}
      {view === 'full' && test && (
        <button
          type="button"
          className={TEST}
          title="Open the test run"
          onClick={(event) => {
            event.stopPropagation()
            openTesting({ ticketId: ticket.id })
          }}
        >
          <span className={cx('size-6 rounded-full', TEST_DOT[test.tone])} aria-hidden />
          {test.text}
        </button>
      )}
      {/* Under the test chip, on a row of its own: what the security pass makes of it (T241). */}
      {view === 'full' && security && (
        <button
          type="button"
          className={SECURITY}
          title="Open the security pass"
          onClick={(event) => {
            event.stopPropagation()
            openReview({ ticketId: ticket.id })
          }}
        >
          <ShieldCheck className={cx('shrink-0', SECURITY_ICON[security.tone])} size={12} aria-hidden />
          {security.text}
        </button>
      )}
      {view === 'full' && (
        <div className="flex items-center gap-8">
          {assignee ? (
            <Avatar name={assignee} person={assigneePerson} size={22} className="shrink-0" />
          ) : (
            <span
              className="inline-flex size-22 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
              aria-hidden
            >
              <UserRound size={11} />
            </span>
          )}
          <span className={cx(WHO, assignee ? 'text-soft-ink-adaptive' : 'text-muted-foreground')}>
            {assignee ?? 'Unclaimed'}
          </span>
          <span className="flex-[1_1_0]" />
          {test?.tester ? (
            <span className={STEP}>
              <span
                className={cx('size-6 rounded-full', test.tone === 'you' ? 'bg-brand-success' : 'bg-muted-foreground')}
                aria-hidden
              />
              {test.tester}
            </span>
          ) : status ? (
            <span className={STATUS}>
              <span className={cx('size-6 rounded-full', STATUS_DOT[status])} aria-hidden />
              {STATUS_LABEL[status]}
            </span>
          ) : (
            ticket.subtasks.length > 0 && (
              <span className="font-normal text-11/[inherit] text-muted-foreground">
                {done}/{ticket.subtasks.length}
              </span>
            )
          )}
        </div>
      )}
    </li>
  )
}

/** One link chip: the first ticket by id, `+1` for the rest, every one of them in its title. */
function LinkChip(props: { ui: string; icon: ReactNode; label: string; codes: string[] }) {
  const [first, ...rest] = props.codes
  return (
    <span data-ui={props.ui} className={LINK} title={`${props.label} ${props.codes.join(', ')}`}>
      {props.icon}
      {props.label}
      <span className="font-code text-soft-ink-adaptive">{first}</span>
      {rest.length > 0 && <span>+{rest.length}</span>}
    </span>
  )
}

/**
 * An epic in the Planning column (frame `Oumw5`): its plan is the one the boss approves once, and
 * under Managed its tickets inherit it. It carries no assignee, so its foot names its planner.
 */
export function EpicCard(props: {
  epic: Epic
  facts: BoardFacts
  tickets: number
  employeeName(id: string): string
  employeePerson(id: string): AvatarPerson | null
  onOpen?(): void
}) {
  const plan = epicPlanOf(props.epic.id, props.facts)
  if (!plan) return null
  const chip = planChip(plan, props.employeeName(plan.plannerId))
  const planner = props.employeeName(plan.plannerId)
  return (
    <li
      data-ui="EpicCard"
      className={cx(CARD, CARD_VIEW.full)}
      tabIndex={props.onOpen ? 0 : undefined}
      onClick={props.onOpen}
      onKeyDown={openOnKey(props.onOpen)}
    >
      <div className="flex items-center gap-8">
        <span className="whitespace-nowrap font-code font-normal text-11/[inherit] text-muted-foreground">
          EP-{props.epic.id}
        </span>
        <span className="font-bold text-9-5/[inherit] text-brand-primary uppercase tracking-[0.08em]">Epic</span>
        <span className="flex-[1_1_0]" />
        <span className="size-7 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
      </div>
      <div className="wrap-anywhere font-medium text-13-5/19 text-foreground">{props.epic.title}</div>
      <div className={cx(PLAN, PLAN_TONE[chip.tone])}>
        <span className={cx('size-6 rounded-full', PLAN_DOT[chip.tone])} aria-hidden />
        {chip.text}
      </div>
      <div className="flex items-center gap-8">
        <Avatar name={planner} person={props.employeePerson(plan.plannerId)} size={22} className="shrink-0" />
        <span className={cx(WHO, 'text-soft-ink-adaptive')}>{planner}</span>
        <span className="flex-[1_1_0]" />
        <span className="font-normal text-11/[inherit] text-muted-foreground">
          {props.tickets} {props.tickets === 1 ? 'ticket' : 'tickets'}
        </span>
      </div>
    </li>
  )
}
