import { cva } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'count'
export type BadgeSize = 'md' | 'sm'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'size'> {
  variant?: BadgeVariant
  /**
   * `sm` is the tighter, dotless 11px pill the row-level frames draw (an Activity row's status,
   * a board card's label): `4px 10px` and no leading dot.
   */
  size?: BadgeSize
}

const badge = cva(
  'inline-flex shrink-0 items-center rounded-full font-sans font-semibold leading-normal whitespace-nowrap',
  {
    variants: {
      size: {
        md: 'gap-6 px-11 py-5 text-12/[normal]',
        /** The dotless row pill of the screen frames (design/html/activity.html:4632). */
        sm: 'gap-0 px-10 py-4 text-11/[normal]',
      },
      variant: {
        neutral: 'bg-secondary text-secondary-foreground',
        primary: 'bg-primary-subtle text-status-info-foreground',
        success: 'bg-status-success text-status-success-foreground',
        warning: 'bg-status-warning text-status-warning-foreground',
        danger: 'bg-status-error text-status-error-foreground',
        count: 'h-22 min-w-22 justify-center bg-primary px-6 py-0 font-bold text-11/[normal] text-primary-foreground',
      },
    },
    defaultVariants: { size: 'md', variant: 'neutral' },
  },
)

/** The dot takes the variant's own ink; `count` and `sm` draw none. */
const DOT: Record<Exclude<BadgeVariant, 'count'>, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-brand-success',
  warning: 'bg-brand-warning',
  danger: 'bg-brand-danger',
}

/** A status pill with a dot, or the round Count badge. */
export function Badge({ variant = 'neutral', size = 'md', className, children, ...rest }: BadgeProps) {
  const dot = variant !== 'count' && size !== 'sm'
  return (
    <span
      data-ui="Badge"
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cx(badge({ variant, size }), className)}
      {...rest}
    >
      {dot && <span data-slot="badge-dot" className={cx('size-6 shrink-0 rounded-full', DOT[variant])} aria-hidden />}
      <span data-slot="badge-label">{children}</span>
    </span>
  )
}
