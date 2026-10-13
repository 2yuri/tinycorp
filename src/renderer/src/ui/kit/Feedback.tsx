import { cva } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const ALERT_ICON: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
}

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant
  title: ReactNode
  onClose?: () => void
}

/** The tint, its ink, and the 3px rule down the leading edge, which is the ink again. */
const alert = cva('flex w-full items-start gap-12 rounded-sm border-l-3 py-16 pr-16 pl-13 font-sans leading-normal', {
  variants: {
    variant: {
      info: 'border-l-status-info-foreground bg-status-info text-status-info-foreground',
      success: 'border-l-status-success-foreground bg-status-success text-status-success-foreground',
      warning: 'border-l-status-warning-foreground bg-status-warning text-status-warning-foreground',
      error: 'border-l-status-error-foreground bg-status-error text-status-error-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
})

/** An inline, tinted alert with a 3px leading rule. */
export function Alert({ variant = 'info', title, onClose, className, children, ...rest }: AlertProps) {
  const Icon = ALERT_ICON[variant]
  return (
    <div
      data-ui="Alert"
      data-slot="alert"
      data-variant={variant}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={cx(alert({ variant }), className)}
      {...rest}
    >
      <Icon data-slot="alert-icon" className="shrink-0" size={18} aria-hidden />
      <div data-slot="alert-text" className="flex min-w-0 flex-[1_1_0] flex-col gap-3">
        <div data-slot="alert-title" className="font-semibold text-14/[normal]">
          {title}
        </div>
        {children !== undefined && (
          <div data-slot="alert-body" className="font-normal text-13/20">
            {children}
          </div>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          data-slot="alert-close"
          className="m-0 flex shrink-0 cursor-pointer border-0 bg-transparent p-0 text-inherit"
          aria-label="Dismiss"
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  action?: { label: ReactNode; onClick: () => void }
}

/** The toast subtree is `data-theme="dark"`, so its tokens resolve to the Dark values. */
const TOAST = 'flex items-center gap-12 rounded-sm bg-brand-ink px-16 py-14 font-sans leading-normal shadow-toast'

/** A toast floats on the dark surface and carries at most one action. */
export function Toast({ icon: Icon = CircleCheck, action, className, children, ...rest }: ToastProps) {
  return (
    <div data-ui="Toast" data-slot="toast" data-theme="dark" role="status" className={cx(TOAST, className)} {...rest}>
      <Icon data-slot="toast-icon" className="shrink-0 text-status-success-foreground" size={18} aria-hidden />
      <div data-slot="toast-message" className="min-w-0 flex-[1_1_0] font-medium text-14/[normal] text-white">
        {children}
      </div>
      {action && (
        <button
          type="button"
          data-slot="toast-action"
          className="m-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-sans font-semibold text-13/[normal] text-status-info-foreground leading-normal"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
