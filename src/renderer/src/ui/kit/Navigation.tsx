import type { ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export interface TabItem {
  id: string
  label: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

/** The divider is drawn inside; the active underline paints over it. */
const TABS = 'flex w-full gap-24 shadow-[inset_0_-1px_0_var(--border)]'

const TAB =
  'flex cursor-pointer items-center gap-8 m-0 border-0 bg-transparent px-0 pt-0 font-sans font-medium text-14/[normal] whitespace-nowrap focus-visible:shadow-focus focus-visible:outline-none'
const TAB_IDLE = 'pb-12 text-muted-foreground hover:text-foreground'
const TAB_ACTIVE = 'pb-10 border-b-2 border-b-primary font-semibold text-primary'

/** Tabs: the active one carries a 2px underline. */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div data-ui="Tabs" data-slot="tabs" role="tablist" className={cx(TABS, className)}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-slot="tab"
            data-active={active || undefined}
            className={cx(TAB, active ? TAB_ACTIVE : TAB_IDLE)}
            onClick={() => onChange(item.id)}
            aria-selected={active}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
