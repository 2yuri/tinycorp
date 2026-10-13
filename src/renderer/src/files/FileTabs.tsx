import { X } from 'lucide-react'
import { type Ref, useEffect, useRef } from 'react'
import { cx } from '../ui'
import { fileIconFor } from './file-icons'
import type { FileTab } from './tabs-model'

export interface FileTabsProps {
  tabs: readonly FileTab[]
  /** The key of the tab the viewer shows. */
  activeKey: string | null
  /** The tabs with work the disk has not seen (T122); each wears a dot in place of its close. */
  dirtyKeys?: readonly string[] | undefined
  onPick(key: string): void
  onClose(key: string): void
}

/**
 * The open files, as tabs above the viewer (T121). The strip sits over the breadcrumb bar, on the
 * shell's own sidebar surface, and the active tab is lifted onto the bar's card colour so the two
 * read as one piece. More tabs than fit scroll sideways; the scrollbar is left out of the chrome.
 *
 * `.files-tab--outside .files-tab__name` was a descendant rule; the tab knows whether its file is
 * from outside, so the dotted underline is chosen at the element instead.
 */
const TABS =
  'flex h-34 shrink-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-sidebar [scrollbar-width:none] [&::-webkit-scrollbar]:h-0'

/* `files-tab` and its modifier lead the class list, adjacent, from the call site:
   `FilesView.test.tsx` counts `class="files-tab` and asserts the pair `files-tab files-tab--on`. */
const TAB =
  'flex max-w-220 shrink-0 items-center border-r border-border bg-transparent text-muted-foreground hover:bg-[color-mix(in_srgb,var(--sidebar-accent)_60%,transparent)]'

const TAB_ON =
  'flex max-w-220 shrink-0 items-center border-r border-border bg-card text-foreground shadow-[inset_0_2px_0_var(--primary)]'

const OPEN =
  'flex h-full min-w-0 flex-1 cursor-pointer items-center gap-8 border-0 bg-transparent py-0 pr-8 pl-12 font-sans text-12-5/[normal] text-inherit'

/* A file from outside the Company: the dotted underline says it is nowhere the Company owns. */
const OUTSIDE =
  'underline decoration-dotted decoration-[color-mix(in_srgb,var(--muted-foreground)_70%,transparent)] underline-offset-3'

const CLOSE =
  'mr-6 flex size-18 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_80%,transparent)] hover:text-foreground'

/**
 * The row of open files above the viewer (T121): one tab per file, with its kind's icon, its name
 * and a close. The active one is the one the viewer shows; a middle click closes a tab, and more
 * tabs than fit scroll, with the active one always brought into view.
 */
export function FileTabs({ tabs, activeKey, dirtyKeys = [], onPick, onClose }: FileTabsProps) {
  const chosen = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active tab or the row changing is what scrolls; the effect reads the ref.
  useEffect(() => {
    chosen.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, tabs.length])

  if (tabs.length === 0) return null
  return (
    <div className={TABS} role="tablist" aria-label="Open files" data-ui="File tabs">
      {tabs.map((tab) => (
        <Tab
          key={tab.key}
          tab={tab}
          active={tab.key === activeKey}
          dirty={dirtyKeys.includes(tab.key)}
          onPick={onPick}
          onClose={onClose}
          ref={tab.key === activeKey ? chosen : undefined}
        />
      ))}
    </div>
  )
}

function Tab({
  tab,
  active,
  dirty,
  onPick,
  onClose,
  ref,
}: {
  tab: FileTab
  active: boolean
  /** True while the tab holds unsaved work, which its dot says before the boss closes it. */
  dirty: boolean
  onPick(key: string): void
  onClose(key: string): void
  ref?: Ref<HTMLDivElement> | undefined
}) {
  const Icon = fileIconFor(tab.path)
  return (
    <div
      ref={ref}
      className={cx('files-tab', active && 'files-tab--on', active ? TAB_ON : TAB)}
      // A middle click closes a tab, the way it closes one anywhere else.
      onAuxClick={(event) => {
        if (event.button !== 1) return
        event.preventDefault()
        onClose(tab.key)
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={cx(OPEN, active && 'font-semibold', tab.placeId === null && OUTSIDE)}
        title={tab.path}
        onClick={() => onPick(tab.key)}
      >
        <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{tab.name}</span>
        {dirty && <span className="files-tab__dot" role="img" aria-label="Edited, not saved" />}
      </button>
      <button type="button" className={CLOSE} aria-label={`Close ${tab.name}`} onClick={() => onClose(tab.key)}>
        <X size={12} aria-hidden />
      </button>
    </div>
  )
}
