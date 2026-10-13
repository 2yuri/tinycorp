import type { HTMLAttributes, ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  /** The footer slot, right-aligned on a muted strip. */
  actions?: ReactNode
}

/** The stroke is drawn inside and on top, as in the design: an `::after` that takes no room. */
const CARD =
  'relative flex min-w-0 flex-[1_1_0] flex-col overflow-hidden rounded-md bg-card font-sans text-card-foreground leading-normal shadow-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:content-[""]'

/** Header slot, content slot, actions slot: leave out what you don't need. */
export function Card({ title, description, actions, className, children, ...rest }: CardProps) {
  return (
    <div data-ui="Card" data-slot="card" className={cx(CARD, className)} {...rest}>
      {(title !== undefined || description !== undefined) && (
        <div data-slot="card-header" className="flex flex-col gap-5 px-20 pt-20 pb-16">
          {title !== undefined && (
            <div data-slot="card-title" className="font-semibold text-17/[normal] text-foreground tracking-[-0.2px]">
              {title}
            </div>
          )}
          {description !== undefined && (
            <div data-slot="card-description" className="font-normal text-13/20 text-muted-foreground">
              {description}
            </div>
          )}
        </div>
      )}
      {children !== undefined && (
        <div
          data-slot="card-content"
          className="flex flex-col gap-12 px-20 pb-20 font-normal text-14/22 text-foreground"
        >
          {children}
        </div>
      )}
      {actions !== undefined && (
        <div data-slot="card-actions" className="flex justify-end gap-10 border-t border-t-border bg-muted px-20 py-14">
          {actions}
        </div>
      )}
    </div>
  )
}
