import { Check, Minus } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import '../tailwind.css'
import { cx } from './cx'

interface ControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  /** `null` for a control whose label sits elsewhere (it then needs an `aria-label`). */
  label: ReactNode
  className?: string
}

/**
 * The label is the group and the real control is inside it, so the box, the knob and the tick read
 * the input's state through `group-has-*` (T216). A sibling variant cannot: the tick lives inside
 * the box, not beside the input, and the `+` the stylesheet used only ever reached the box.
 *
 * The group is **named** — `group/choice` — because `group-*` matches any ancestor carrying the
 * class, and an unnamed one would pick up a screen's own `group` two boxes up.
 */
const CHOICE =
  'group/choice relative inline-flex shrink-0 cursor-pointer items-center gap-10 has-[:disabled]:cursor-default has-[:disabled]:opacity-50'

/** The real control, out of flow: on the keyboard and in the accessibility tree, and never drawn. */
const CHOICE_INPUT = 'pointer-events-none absolute h-1 w-1 m-0 opacity-0'

const CHOICE_BOX =
  'flex size-18 shrink-0 items-center justify-center border border-input bg-card text-primary-foreground group-has-[:focus-visible]/choice:shadow-focus'
const CHECKBOX_BOX =
  'rounded-[5px] group-has-checked/choice:border-primary group-has-checked/choice:bg-primary group-has-indeterminate/choice:border-primary group-has-indeterminate/choice:bg-primary'
const RADIO_BOX = 'rounded-full group-has-checked/choice:border-2 group-has-checked/choice:border-primary'

const CHOICE_LABEL = 'font-sans font-normal text-14/[normal] text-foreground whitespace-nowrap'

/**
 * A checkbox, with the third state a parent needs: `mixed` is some of what it stands for, and it
 * draws a dash where a tick would be. Screen readers are told through `aria-checked="mixed"`.
 */
export function Checkbox({ label, className, mixed, ...input }: ControlProps & { mixed?: boolean }) {
  return (
    <label data-ui="Checkbox" data-slot="choice" className={cx(CHOICE, className)}>
      <input
        type="checkbox"
        data-slot="choice-input"
        className={CHOICE_INPUT}
        ref={(node) => {
          if (node) node.indeterminate = mixed === true
        }}
        aria-checked={mixed ? 'mixed' : undefined}
        {...input}
      />
      <span data-slot="choice-box" className={cx(CHOICE_BOX, CHECKBOX_BOX)} aria-hidden>
        <Check size={12} strokeWidth={3} data-slot="choice-tick" className="hidden group-has-checked/choice:block" />
        <Minus
          size={12}
          strokeWidth={3}
          data-slot="choice-dash"
          className="hidden group-has-indeterminate/choice:block"
        />
      </span>
      <ChoiceLabel label={label} />
    </label>
  )
}

export function Radio({ label, className, ...input }: ControlProps) {
  return (
    <label data-ui="Radio" data-slot="choice" className={cx(CHOICE, className)}>
      <input type="radio" data-slot="choice-input" className={CHOICE_INPUT} {...input} />
      <span data-slot="choice-box" className={cx(CHOICE_BOX, RADIO_BOX)} aria-hidden>
        <span data-slot="choice-dot" className="hidden size-8 rounded-full bg-primary group-has-checked/choice:block" />
      </span>
      <ChoiceLabel label={label} />
    </label>
  )
}

const TOGGLE_TRACK =
  'flex h-22 w-40 shrink-0 items-center justify-start rounded-full bg-input p-3 group-has-checked/choice:justify-end group-has-checked/choice:bg-primary group-has-[:focus-visible]/choice:shadow-focus'

export function Toggle({ label, className, ...input }: ControlProps) {
  return (
    <label data-ui="Toggle" data-slot="choice" className={cx(CHOICE, className)}>
      {/* A native checkbox already maps `checked` to `aria-checked`; the switch role wants the
          attribute written out, so a controlled Toggle mirrors it and an uncontrolled one omits it. */}
      <input
        type="checkbox"
        role="switch"
        data-slot="choice-input"
        className={CHOICE_INPUT}
        aria-checked={input.checked}
        {...input}
      />
      <span data-slot="toggle-track" className={TOGGLE_TRACK} aria-hidden>
        <span data-slot="toggle-knob" className="size-16 rounded-full bg-white shadow-knob" />
      </span>
      <ChoiceLabel label={label} />
    </label>
  )
}

/**
 * No label, no slot: an empty one still takes the control's 10px gap, which pushes a toggle that
 * sits at a row's end 10px short of it (T148).
 */
function ChoiceLabel({ label }: { label: ReactNode }) {
  if (label === null || label === undefined || label === false) return null
  return (
    <span data-slot="choice-label" className={CHOICE_LABEL}>
      {label}
    </span>
  )
}

export interface ProgressProps {
  /** 0–100. */
  value: number
  label?: ReactNode
  /** Shows the percentage beside the label. */
  showValue?: boolean
  className?: string
}

export function Progress({ value, label, showValue = label !== undefined, className }: ProgressProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div data-ui="Progress" data-slot="progress" className={cx('flex w-220 flex-col gap-8', className)}>
      {(label !== undefined || showValue) && (
        <div
          data-slot="progress-top"
          className="flex w-full items-center justify-between whitespace-nowrap leading-normal"
        >
          <span data-slot="progress-label" className="font-sans font-semibold text-12/[normal] text-foreground">
            {label}
          </span>
          {showValue && (
            <span data-slot="progress-value" className="font-code font-normal text-12/[normal] text-muted-foreground">
              {percent}%
            </span>
          )}
        </div>
      )}
      <div
        data-slot="progress-track"
        className="h-8 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          data-slot="progress-bar"
          className="h-full rounded-full bg-[linear-gradient(-90deg,var(--primary)_0%,var(--accent)_100%)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
