import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId } from 'react'
import { cx } from './cx'
import { CHOICE_INPUT } from './resets'
import '../tailwind.css'

/**
 * One track, equal options, the chosen one filled — the control five settings cards, the Memory
 * list and the routing tab each drew for themselves (T213).
 *
 * **The look is a set of lists, not a merge.** A caller that wants another frame's track passes
 * every list, and the defaults below are dropped whole. Two lists merged would put `bg-transparent`
 * and `bg-muted` on one element in one layer, and which of them the track wore would be Tailwind's
 * sort order rather than the caller's — the same trap that took the fill off the chosen option
 * twice during the migration. So a frame either takes these measurements or brings its own.
 *
 * **Two shapes, one control.** With a `name` it is a real radio group: a `<label>` per option over
 * a `.choice-input`, which is what `a11y/useSemanticElements` asks for where the options are one
 * setting's values. Without one it is a row of buttons carrying `aria-pressed`, which is what a
 * filter is. Both draw the same thing, and the frames do not distinguish them.
 */
export const SEGMENTED_TRACK = 'flex h-32 items-center gap-3 rounded-sm border border-border bg-transparent p-2'

/**
 * One option of that track. **No `p-0`**: a `<button>` keeps whatever padding no rule wrote, and
 * zeroing it moved the label of every segment by a pixel when the settings tab was migrated.
 * **`h-26`, not `h-full`**: the track is a `<fieldset>`, and Chromium lays a fieldset's children
 * out in an anonymous box whose height a percentage cannot resolve against, so `h-full` came out
 * as the label's own height and the picked segment was a thin bar at the top. 26 is the track's
 * 32 less its 1px border and 2px padding on each side.
 */
export const SEGMENTED_OPTION =
  'inline-flex h-26 flex-[1_1_0] cursor-pointer items-center justify-center gap-6 rounded-sm border-0 font-sans text-12/[inherit]'
export const SEGMENTED_ON = 'bg-primary font-semibold text-primary-foreground'
export const SEGMENTED_OFF = 'bg-transparent font-medium text-muted-foreground hover:text-foreground'

export interface SegmentedOption<T> {
  value: T
  label: ReactNode
  icon?: LucideIcon
  iconSize?: number
}

/** The four lists a frame sets: the track, one option, and the two states it is in. */
export interface SegmentedClasses {
  track?: string
  option?: string
  on?: string
  off?: string
}

export interface SegmentedControlProps<T extends string | number> {
  /** What the set is, for a screen reader: the `aria-label` on the track. */
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange(value: T): void
  /** A radio group rather than a row of pressed buttons: the name the radios share. */
  name?: string
  classes?: SegmentedClasses
  className?: string
}

export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  name,
  classes,
  className,
}: SegmentedControlProps<T>) {
  const generated = useId()
  const group = name === undefined ? undefined : `${name}-${generated}`
  const option = classes?.option ?? SEGMENTED_OPTION
  const on = classes?.on ?? SEGMENTED_ON
  const off = classes?.off ?? SEGMENTED_OFF
  return (
    <fieldset
      data-ui="Segmented Control"
      className={cx(classes?.track ?? SEGMENTED_TRACK, className)}
      aria-label={label}
      {...(group === undefined ? {} : { role: 'radiogroup' })}
    >
      {options.map((item) => {
        const picked = item.value === value
        const inside = (
          <>
            {item.icon && <item.icon size={item.iconSize ?? 13} aria-hidden />}
            {item.label}
          </>
        )
        return group === undefined ? (
          <button
            key={item.value}
            type="button"
            className={cx(option, picked ? on : off)}
            aria-pressed={picked}
            onClick={() => onChange(item.value)}
          >
            {inside}
          </button>
        ) : (
          <label key={item.value} className={cx(option, picked ? on : off)}>
            <input
              type="radio"
              data-slot="choice-input"
              className={CHOICE_INPUT}
              name={group}
              checked={picked}
              onChange={() => onChange(item.value)}
            />
            {inside}
          </label>
        )
      })}
    </fieldset>
  )
}
