import {
  ArrowRightLeft,
  BookA,
  BookMarked,
  Boxes,
  GitBranch,
  History,
  type LucideIcon,
  Ruler,
  Scale,
  Snowflake,
  Sparkles,
  Split,
  TriangleAlert,
} from 'lucide-react'
import {
  countsLine,
  HANDOFF_STATE_LABEL,
  type HandoffState,
  MEMORY_KIND_LABEL,
  type MemoryCounts,
  type MemoryKind,
  type MemoryPageSummary,
  type MemorySort,
  rowSource,
  whenLabel,
} from '../../../shared/memory/company-memory'
import { Badge, cx, EmptyState, Search, SegmentedControl, SHELL_BUTTON } from '../ui'
import { emptyList, kindChips, SORT_BUTTONS } from './memory-view'

/** The mark a row and a page carry for their kind, as the frame draws them (`E40vSb`). */
export const KIND_ICON: Record<MemoryKind, LucideIcon> = {
  decision: Scale,
  convention: Ruler,
  gotcha: TriangleAlert,
  architecture: Boxes,
  glossary: BookA,
  handoff: ArrowRightLeft,
}

/** The icon each option of the sort control carries. */
const SORT_ICON: Record<MemorySort, LucideIcon> = {
  used: History,
  new: Sparkles,
  cold: Snowflake,
}

/** What a Handoff's pill reads as: waiting on someone, taken, or over. */
const HANDOFF_TONE: Record<HandoffState, 'warning' | 'success' | 'neutral'> = {
  open: 'warning',
  claimed: 'success',
  done: 'neutral',
}

export interface MemoryListProps {
  rows: MemoryPageSummary[]
  counts: MemoryCounts
  search: string
  onSearch(value: string): void
  kind: MemoryKind | null
  onKind(kind: MemoryKind | null): void
  sort: MemorySort
  onSort(sort: MemorySort): void
  openSlug: string | null
  onOpen(slug: string): void
  onWriteFirst(): void
  now?: number
}

/**
 * The list column (frames `E40vSb`, `I44S1a`), as utilities. Every size-only rule here says
 * `/[normal]`, because the shell root sets `line-height: normal` and the whole app inherits it —
 * taking the type scale's own leading instead would move each of these rows by half a pixel.
 *
 * `memory-row`, `memory-row__kind`, `memory-seg` and `memory-seg__option` stay in the lists:
 * `MemoryScreen.dom.test.tsx` reads the open row through `[aria-current]`, counts the kind pills,
 * and walks the sort control by `.memory-seg .memory-seg__option`.
 */
const LIST = 'flex min-h-0 flex-col basis-404 grow-0 shrink-0 border-r border-border bg-card'

const HEAD = 'flex flex-col gap-12 border-b border-border px-16 pt-14 pb-12'

/* The frame's search is the panel's own box: the kit pill, squared and shortened to 31px. */
const SEARCH_FIELD =
  '[&_[data-slot=field-control]]:h-31 [&_[data-slot=field-control]]:gap-8 [&_[data-slot=field-control]]:rounded-sm [&_[data-slot=field-control]]:px-10 [&_[data-slot=field-control]]:focus-within:px-9 [&_[data-slot=field-icon]]:size-13 [&_[data-slot=field-input]]:text-12-5'

/*
 * A kind chip, off and on. Two **whole lists**, not a list and an override: `.--on` used to say
 * `border-color: transparent; background: var(--secondary)` and win by coming later in the sheet,
 * and two `bg-*` utilities on one element are settled by Tailwind's own emission order instead —
 * `bg-transparent` kept the fill off the chosen chip until the pixel table caught it. Every
 * base/variant pair in these six folders is written out for the same reason.
 */
const CHIP =
  'memory-chip inline-flex h-28 cursor-pointer items-center gap-6 whitespace-nowrap rounded-full border border-border bg-transparent px-11 py-0 font-sans font-medium text-12/[normal] text-muted-foreground hover:text-foreground'

const CHIP_ON =
  'memory-chip inline-flex h-28 cursor-pointer items-center gap-6 whitespace-nowrap rounded-full border border-transparent bg-secondary px-11 py-0 font-sans font-bold text-12/[normal] text-foreground'

const SORT_LABEL = 'font-bold text-11/[normal] uppercase tracking-[0.5px] text-muted-foreground'

const SEG = 'memory-seg flex h-30 flex-1 items-center gap-3 rounded-sm border border-border bg-card p-3'

/** `shell-btn` is the reset a bare `<button>` still needs; the two states carry everything else. */
const SEG_RESET = SHELL_BUTTON

const SEG_OPTION =
  'memory-seg__option inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-6 whitespace-nowrap rounded-sm bg-transparent font-sans font-normal text-12/[normal] text-muted-foreground hover:text-foreground'

const SEG_ON =
  'memory-seg__option inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-6 whitespace-nowrap rounded-sm bg-primary font-sans font-semibold text-12/[normal] text-primary-foreground'

const ROWS = 'flex min-h-0 flex-1 flex-col overflow-auto'

const EMPTY_ACTION =
  'h-34 cursor-pointer rounded-sm bg-primary px-16 py-0 font-sans font-semibold text-13/[normal] text-primary-foreground'

const FOOTER = 'flex items-center gap-8 border-t border-border px-16 py-10 text-11/[normal] text-muted-foreground'

const ROW =
  'memory-row flex cursor-pointer flex-col gap-6 border-b border-border bg-transparent px-16 py-11 text-left hover:bg-veil-soft'

/*
 * The box only: the weight and the ink are chosen at the element, once each. The sheet had
 * `font-weight: 600` here, `700` on the open row and a muted colour on a cold one, and won each by
 * coming later; two utilities for one property leave that to Tailwind's emission order — which drew
 * the open row's title at 600 until the pixel table caught it.
 */
const ROW_TITLE = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-13/[normal]'

const META = 'flex items-center gap-8 pl-21'

const SOURCE = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-11-5/[normal] text-muted-foreground'

const FLAG = 'inline-flex items-center gap-4 whitespace-nowrap rounded-full px-7 py-2 font-semibold text-10-5/12'

const FLAG_CLASH = 'bg-[color-mix(in_srgb,var(--brand-warning)_16%,transparent)] text-brand-warning'

const FLAG_COLD = 'bg-primary-subtle text-status-info-foreground'

/** The left column of the Memory screen (frame `E40vSb`): search, kind chips, sort, rows, counts. */
export function MemoryList(props: MemoryListProps) {
  const now = props.now ?? Date.now()
  const filtered = props.search.trim() !== '' || props.kind !== null
  const empty = emptyList(props.counts, filtered)

  return (
    <div className={LIST} data-ui="Memory list">
      <div className={HEAD}>
        <Search
          className={SEARCH_FIELD}
          size="compact"
          shortcut="⌘K"
          placeholder="Search the Company’s memory"
          aria-label="Search the Company’s memory"
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
        />

        <fieldset className="flex flex-wrap gap-x-6 gap-y-12" aria-label="Kinds">
          {kindChips(props.counts).map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={cx(SHELL_BUTTON, chip.kind === props.kind ? CHIP_ON : CHIP)}
              aria-pressed={chip.kind === props.kind}
              onClick={() => props.onKind(chip.kind)}
            >
              {chip.label}
              <span className="font-code font-normal text-10-5/[normal] text-muted-foreground tabular-nums">
                {chip.count}
              </span>
            </button>
          ))}
        </fieldset>

        <div className="flex items-center gap-10">
          <span className={SORT_LABEL}>Sort</span>
          {/* One segmented control, as the frame draws it: three equal options, the chosen one filled. */}
          <SegmentedControl
            label="Sort"
            value={props.sort}
            options={SORT_BUTTONS.map((button) => ({
              value: button.key,
              label: button.label,
              icon: SORT_ICON[button.key],
              iconSize: 12,
            }))}
            onChange={props.onSort}
            classes={{ track: SEG, option: SEG_RESET, on: SEG_ON, off: SEG_OPTION }}
          />
        </div>
      </div>

      {/* The frame centres the empty card in the space the rows would have filled. */}
      <div className={cx(ROWS, props.rows.length === 0 && 'items-center justify-center p-16')}>
        {props.rows.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title={empty.title}
            body={empty.body}
            action={
              filtered || props.counts.pages > 0 ? undefined : (
                <button type="button" className={cx(SHELL_BUTTON, EMPTY_ACTION)} onClick={props.onWriteFirst}>
                  Write the first page
                </button>
              )
            }
          />
        ) : (
          props.rows.map((row) => (
            <Row
              key={row.slug}
              row={row}
              now={now}
              open={row.slug === props.openSlug}
              onOpen={props.onOpen}
              handoffState={props.kind === 'handoff'}
            />
          ))
        )}
      </div>

      <footer className={FOOTER}>
        <GitBranch size={13} aria-hidden />
        {countsLine(props.counts)}
      </footer>
    </div>
  )
}

function Row({
  row,
  now,
  open,
  onOpen,
  handoffState,
}: {
  row: MemoryPageSummary
  now: number
  open: boolean
  onOpen(slug: string): void
  /**
   * Where a Handoff stands is the Handoffs filter's business (`I44S1a`a), not the All list's: in
   * `E40vSb` the row says who claimed it, and where, in its second line and carries no pill.
   */
  handoffState: boolean
}) {
  const Icon = KIND_ICON[row.kind]
  return (
    <button
      type="button"
      className={cx(SHELL_BUTTON, ROW, open && 'bg-veil')}
      aria-current={open ? 'true' : undefined}
      onClick={() => onOpen(row.slug)}
    >
      <span className="flex items-center gap-8">
        <Icon className={cx('flex-none', row.cold ? 'text-muted-foreground' : 'text-soft-ink')} size={13} aria-hidden />
        <span
          className={cx(
            ROW_TITLE,
            open ? 'font-bold' : 'font-semibold',
            row.cold ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {row.title}
        </span>
        <span className="flex-none text-11/[normal] text-muted-foreground">
          {whenLabel(row.lastUsedAt ?? row.updatedAt, now)}
        </span>
      </span>
      <span className={META}>
        <Badge className="memory-row__kind px-7 py-2 text-10-5/12 text-soft-ink" size="sm" variant="neutral">
          {MEMORY_KIND_LABEL[row.kind]}
        </Badge>
        <span className={SOURCE}>{rowSource(row)}</span>
        {handoffState && row.handoff && (
          <Badge size="sm" variant={HANDOFF_TONE[row.handoff.state]}>
            {HANDOFF_STATE_LABEL[row.handoff.state]}
          </Badge>
        )}
        {row.contradiction && (
          <span className={cx(FLAG, FLAG_CLASH)}>
            <Split size={11} aria-hidden />
            contradiction?
          </span>
        )}
        {row.cold && (
          <span className={cx(FLAG, FLAG_COLD)}>
            <Snowflake size={11} aria-hidden />
            cold
          </span>
        )}
      </span>
    </button>
  )
}
