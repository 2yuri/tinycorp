import type { LucideIcon } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon
  title: ReactNode
  body?: ReactNode
  /** Usually one primary Button. */
  action?: ReactNode
  /** `inline` for a panel that is already a card: the same block without a second box around it. */
  variant?: 'card' | 'inline'
}

const EMPTY_STATE = 'flex w-full flex-col items-center gap-10 font-sans leading-normal'
const EMPTY_STATE_CARD = 'rounded-md border border-border bg-card p-27'
/**
 * The same block in a space that is already a card (T213): the chip, the title and the line,
 * with no box at all — not a box cancelled, because the two are one choice here and only one of
 * them is ever written.
 */
const EMPTY_STATE_INLINE = ''

export function EmptyState({ icon: Icon, title, body, action, variant = 'card', className, ...rest }: EmptyStateProps) {
  return (
    <div
      data-ui="Empty State"
      data-slot="empty-state"
      className={cx(EMPTY_STATE, variant === 'inline' ? EMPTY_STATE_INLINE : EMPTY_STATE_CARD, className)}
      {...rest}
    >
      {Icon && (
        <span
          data-slot="empty-state-chip"
          className="flex size-44 items-center justify-center rounded-full bg-primary-subtle text-primary"
        >
          <Icon size={20} aria-hidden />
        </span>
      )}
      <div data-slot="empty-state-title" className="whitespace-nowrap font-semibold text-15/[normal] text-foreground">
        {title}
      </div>
      {body !== undefined && (
        <div data-slot="empty-state-body" className="w-full text-center font-normal text-13/20 text-muted-foreground">
          {body}
        </div>
      )}
      {action}
    </div>
  )
}
