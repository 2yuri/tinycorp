import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'
import { Kbd } from './Kbd'

/**
 * The frame's inside stroke, drawn over the rows and taking no room. It is the box's own outline
 * and not an `::after`, because a menu that scrolls (the model picker, the chat palette) would
 * scroll a pseudo-element away with its content.
 */
const MENU =
  'relative flex flex-col gap-2 rounded-sm bg-popover p-6 text-popover-foreground shadow-menu outline-1 -outline-offset-1 outline-border'

/* `ComponentProps<'div'>` rather than `HTMLAttributes`, for the `ref` a caller that has to know
   whether a pointer went down inside the box needs (`useDismiss`, T223). */
export function DropdownMenu({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div data-ui="Dropdown Menu" data-slot="menu" role="menu" className={cx(MENU, className)} {...rest}>
      {children}
    </div>
  )
}

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon | undefined
  label: ReactNode
  shortcut?: string
  destructive?: boolean
  /** The highlighted row (keyboard focus or hover). */
  highlighted?: boolean
}

const MENU_ITEM =
  'flex w-full cursor-pointer items-center gap-10 m-0 rounded-[6px] border-0 bg-transparent px-10 py-9 text-left font-sans font-normal text-13/[normal] text-foreground [&_svg]:shrink-0 [&_[data-slot=kbd]]:text-10/[normal] hover:bg-secondary hover:outline-none focus-visible:bg-secondary focus-visible:outline-none disabled:cursor-default disabled:opacity-50'

export function MenuItem({ icon: Icon, label, shortcut, destructive, highlighted, className, ...rest }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-ui="Menu Item"
      data-slot="menu-item"
      data-destructive={destructive || undefined}
      data-highlighted={highlighted || undefined}
      className={cx(
        MENU_ITEM,
        destructive && 'text-destructive',
        highlighted && 'bg-secondary outline-none',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={15} aria-hidden />}
      <span data-slot="menu-item-label" className="min-w-0 flex-[1_1_0]">
        {label}
      </span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  )
}

export function MenuDivider() {
  return <hr data-slot="menu-divider" className="m-0 h-1 w-full shrink-0 border-0 bg-border" />
}
