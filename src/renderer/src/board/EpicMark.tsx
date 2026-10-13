import type { Epic } from '../../../shared/domain/board'
import { cx } from '../ui'
import { DOT_INK } from './TicketExtras'
import '../ui/tailwind.css'

/**
 * Which epic a ticket is in: the epic's own dot and its title, cut short when the row is (T274,
 * frames `RIko3` and `SA8tW`). The board card draws it where every card had a slate dot, and the
 * Employee drawer's ticket card on a line under the title; the caller sets the type and the gap.
 */
export function EpicMark(props: { epic: Pick<Epic, 'title' | 'color'>; className?: string }) {
  return (
    <span
      data-slot="epic-mark"
      className={cx('inline-flex min-w-0 items-center gap-5 text-muted-foreground', props.className)}
      title={`Epic: ${props.epic.title}`}
    >
      <span className={cx('size-7 shrink-0 rounded-full', DOT_INK[props.epic.color])} aria-hidden />
      <span className="sr-only">Epic: </span>
      <span className="truncate">{props.epic.title}</span>
    </span>
  )
}
