import type { ReactNode } from 'react'
import '../tailwind.css'

/** A keyboard shortcut hint (⌘K) in the mono face. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      data-slot="kbd"
      className="shrink-0 whitespace-nowrap font-code font-normal text-11/[normal] text-muted-foreground"
    >
      {children}
    </kbd>
  )
}
