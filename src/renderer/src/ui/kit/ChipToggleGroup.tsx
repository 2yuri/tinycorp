import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import '../tailwind.css'

/**
 * A row of chips, each one on or off — the digest's days, the Memory list's kinds, a ticket's
 * repositories (T213). One row of markup where three screens each wrote their own.
 *
 * `multiple` is what the row means, not how it looks: a digest is every day the boss ticked, a
 * Memory filter is one kind at a time. It is the difference between `aria-pressed` on each chip and
 * a set the reader hears as one choice, and it is the one thing a screen got wrong twice by hand.
 *
 * The four lists work as `SegmentedControl`'s do: a frame takes these measurements or brings its
 * own, and nothing is merged.
 */
export const CHIP_ROW = 'flex flex-wrap gap-6'

/** The frame's day pill: 6/11 around a 12px label, with its stroke inside that padding. */
export const CHIP =
  'cursor-pointer rounded-full border p-0 px-10 py-5 font-sans text-12/[inherit] font-normal disabled:cursor-default disabled:opacity-50 focus-visible:shadow-focus focus-visible:outline-none'
export const CHIP_ON = 'border-primary bg-primary-subtle text-primary'
export const CHIP_OFF = 'border-border bg-transparent text-muted-foreground'

export interface ChipOption<T> {
  value: T
  label: ReactNode
  icon?: LucideIcon
  iconSize?: number
  /** The count, the path, whatever the frame draws after the label. */
  after?: ReactNode
  title?: string
  disabled?: boolean
}

export interface ChipClasses {
  row?: string
  chip?: string
  on?: string
  off?: string
}

export interface ChipToggleGroupProps<T extends string | number> {
  /** What the row is, for a screen reader: the `aria-label` on the set. */
  label: string
  options: readonly ChipOption<T>[]
  /** Every chip that is on. One entry for a row where only one can be. */
  selected: readonly T[]
  onToggle(value: T): void
  /** Whether the row is a set of independent chips or one choice among them. */
  multiple?: boolean
  disabled?: boolean
  classes?: ChipClasses
  className?: string
  /** Drawn before the chips — the "No repositories yet." a row with nothing to offer says. */
  empty?: ReactNode
}

export function ChipToggleGroup<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  multiple = true,
  disabled,
  classes,
  className,
  empty,
}: ChipToggleGroupProps<T>) {
  const chip = classes?.chip ?? CHIP
  const on = classes?.on ?? CHIP_ON
  const off = classes?.off ?? CHIP_OFF
  return (
    <fieldset
      data-ui="Chip Toggle Group"
      className={cx(classes?.row ?? CHIP_ROW, className)}
      aria-label={label}
      {...(multiple ? {} : { role: 'radiogroup' })}
    >
      {options.length === 0 && empty}
      {options.map((item) => {
        const picked = selected.includes(item.value)
        return (
          <button
            key={item.value}
            type="button"
            title={item.title}
            disabled={disabled === true || item.disabled === true}
            className={cx(chip, picked ? on : off)}
            {...(multiple ? { 'aria-pressed': picked } : { 'aria-checked': picked, role: 'radio' })}
            onClick={() => onToggle(item.value)}
          >
            {item.icon && <item.icon size={item.iconSize ?? 13} aria-hidden />}
            {item.label}
            {item.after}
          </button>
        )
      })}
    </fieldset>
  )
}
