import { ChevronDown, ChevronRight, Square, SquareCheckBig } from 'lucide-react'
import { useId, useState } from 'react'
import { COLUMN_TITLES, type Epic, type Subtask, type Ticket } from '../../../shared/domain/board'
import { ticketCode } from '../../../shared/ticket-id'
import { EpicMark } from '../board'
import { Badge, CHOICE_INPUT, cx, Progress, SHELL_BUTTON } from '../ui'
import { rememberChecklistOpen, rememberedChecklistOpen } from './checklist-fold'
import { subtaskProgress } from './drawer-model'

/**
 * The drawer's current-ticket card (Current Ticket › Card).
 *
 * `PILL` is the drawer's small badge, exported because the head draws the same one: `.drawer-pill`
 * was one rule for both. It carries **no size** — the head sets 11 and a ticket sets 10.5, and two
 * font-size utilities on one element would be settled by Tailwind's own order rather than by the
 * order they are written in.
 *
 * `:has(> .choice-input:…)` survives as `has-[>[data-slot=choice-input]:…]`, which is what keeps the row inert
 * for a subtask nobody may tick and gives it the focus ring when the box inside it takes focus.
 */
export const PILL = 'bg-secondary px-9 py-3 text-soft-ink'

const CARD = 'flex shrink-0 flex-col gap-9 rounded-sm border border-border bg-card p-12'

const ID = 'whitespace-nowrap font-code text-11/[normal] text-muted-foreground'

const SUBTASK =
  'm-0 flex w-full min-h-15 cursor-pointer items-center gap-8 border-0 bg-transparent p-0 text-left font-normal text-12/[normal] text-soft-ink has-[>[data-slot=choice-input]:disabled]:cursor-default has-[>[data-slot=choice-input]:focus-visible]:shadow-focus has-[>[data-slot=choice-input]:focus-visible]:outline-none [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

const SUBTASK_DONE =
  'm-0 flex min-h-15 w-full cursor-pointer items-center gap-8 border-0 bg-transparent p-0 text-left font-normal text-12/[normal] text-muted-foreground has-[>[data-slot=choice-input]:disabled]:cursor-default has-[>[data-slot=choice-input]:focus-visible]:shadow-focus has-[>[data-slot=choice-input]:focus-visible]:outline-none [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

const PROGRESS = 'flex flex-col gap-8 [&_[data-slot=progress]]:w-full [&_[data-slot=progress-bar]]:bg-brand-text-muted'

const PROGRESS_TOP =
  'flex items-center justify-between whitespace-nowrap font-semibold text-12/[normal] text-foreground'

/** The same row as the button that folds the checklist (TI-2). */
const PROGRESS_TOGGLE = cx(
  SHELL_BUTTON,
  PROGRESS_TOP,
  'w-full gap-6 rounded-[4px] p-0 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
)

/**
 * An opened checklist under the terminal scrolls inside the card: the card is given a bounded
 * height by the drawer (`TICKET_SLOT` there), and the list is the part that gives way (TI-2).
 */
const LIST_BOUNDED = 'min-h-0 shrink overflow-y-auto overscroll-contain'

/** A ticket as the drawer shows it: id, title, column, its epic, subtask checklist and progress. */
export function TicketCard({
  ticket,
  companyKey,
  epic,
  onToggle,
  foldable,
}: {
  ticket: Ticket
  /** The Company key its display id carries, `TC` in `TC-142` (decision 33). */
  companyKey: string
  /** The epic the ticket is in, or null when it is in none. */
  epic?: Pick<Epic, 'title' | 'color'> | null | undefined
  /** Ticks or unticks a subtask; the checklist is read-only without it. */
  onToggle?(subtask: Subtask): void
  /**
   * The card under the terminal: the checklist folds behind the Subtasks row, starts folded and
   * scrolls when opened (TI-2). The Ticket tab leaves it out and shows every list whole.
   */
  foldable?: boolean
}) {
  const progress = subtaskProgress(ticket)
  const [open, setOpen] = useState(rememberedChecklistOpen)
  const listId = useId()
  const folds = foldable === true && ticket.subtasks.length > 0
  const shown = !folds || open
  const Chevron = open ? ChevronDown : ChevronRight
  const count = (
    <span className="font-code font-normal text-muted-foreground">
      {progress.done} / {progress.total}
    </span>
  )
  return (
    <article className={cx(CARD, folds && 'min-h-0 shrink')} data-testid="drawer-ticket">
      <div className="flex items-center gap-8">
        <span className={ID}>{ticketCode(companyKey, ticket.id)}</span>
        <span className="min-w-0 flex-1 font-semibold text-13/[normal] text-foreground">{ticket.title}</span>
        <Badge variant="neutral" className={cx(PILL, 'text-10-5')}>
          {COLUMN_TITLES[ticket.column]}
        </Badge>
      </div>
      {/* The epic the ticket is in, on a line of its own under the title (T274, frame `SA8tW`). */}
      {epic && <EpicMark epic={epic} className="max-w-full gap-6 self-start text-11-5/[normal]" />}
      {ticket.blocked && (
        <p className="m-0 text-12/[normal] text-status-error-foreground">
          Blocked{ticket.blockedReason ? `: ${ticket.blockedReason}` : ''}
        </p>
      )}
      {ticket.subtasks.length > 0 && shown && (
        <ul id={listId} className={cx('m-0 flex list-none flex-col gap-6 p-0', folds && LIST_BOUNDED)}>
          {ticket.subtasks.map((subtask) => {
            const Icon = subtask.done ? SquareCheckBig : Square
            return (
              <li key={subtask.id}>
                <label className={subtask.done ? SUBTASK_DONE : SUBTASK}>
                  <input
                    type="checkbox"
                    data-slot="choice-input"
                    className={CHOICE_INPUT}
                    disabled={!onToggle}
                    checked={subtask.done}
                    onChange={() => onToggle?.(subtask)}
                  />
                  <Icon size={13} aria-hidden />
                  <span>{subtask.title}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className={PROGRESS}>
        {folds ? (
          <button
            type="button"
            className={PROGRESS_TOGGLE}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              rememberChecklistOpen(!open)
              setOpen(!open)
            }}
          >
            <Chevron size={13} aria-hidden />
            <span className="flex-1">Subtasks</span>
            {count}
          </button>
        ) : (
          <div className={PROGRESS_TOP}>
            <span>Subtasks</span>
            {count}
          </div>
        )}
        <Progress value={progress.percent} />
      </div>
    </article>
  )
}
