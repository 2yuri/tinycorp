import type { LucideIcon } from 'lucide-react'
import { ChevronDown, CircleAlert, Search as SearchIcon } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import '../tailwind.css'
import { cx } from './cx'
import { Kbd } from './Kbd'

/**
 * Whether a field has anything to say under its control.
 *
 * The kit used to keep the line whatever happened, so that an error appearing never moved the
 * layout. No frame draws it: five screens cancelled it by hand, each with its own `display: none`
 * and its own rule putting it back for an error, and the sixth would have been the next one to
 * (T200). A field with a helper draws it; a field without one is as tall as its control.
 */
function hasHelper(helper: ReactNode) {
  return helper !== undefined && helper !== null && helper !== false && helper !== ''
}

/** The `aria-describedby` of a control whose helper is drawn — and nothing when it is not. */
function helperId(id: string, helper: ReactNode) {
  return hasHelper(helper) ? `${id}-helper` : undefined
}

const FIELD = 'flex min-w-0 flex-[1_1_0] flex-col gap-7 font-sans leading-normal'
const LABEL = 'font-semibold text-13/[normal] text-foreground whitespace-nowrap'
/** Only drawn when the field has something to say: no frame reserves an empty line under a field. */
const HELPER = 'font-normal text-12/[normal] text-muted-foreground whitespace-nowrap'

/**
 * The stroke sits inside the box (as in the design), so the focused state gives a padding pixel
 * back for the second border pixel and the box never changes size.
 */
const CONTROL =
  'flex w-full items-center gap-10 rounded-sm border border-input bg-card px-13 py-10 focus-within:border-2 focus-within:border-ring focus-within:px-12 focus-within:py-9 focus-within:shadow-focus'
/** An error keeps the one-pixel stroke on focus, so the box does not step when it goes wrong. */
const CONTROL_ERROR = 'border-destructive focus-within:border focus-within:px-13 focus-within:py-10'
const CONTROL_SEARCH = 'rounded-full'
/**
 * The filter over a panel's own list (design/screens/ZNpqJ.png: the Files tree): filled and flat
 * rather than outlined, short enough that it reads as part of the panel and not a form field. It
 * carries no stroke, so a focus ring is all that grows — the box never changes size.
 */
const CONTROL_FILLED =
  'h-32 rounded-sm border-0 bg-secondary px-10 py-0 [&_[data-slot=field-input]]:text-13/[normal] focus-within:h-32 focus-within:rounded-sm focus-within:border-0 focus-within:bg-secondary focus-within:px-10 focus-within:py-0 focus-within:shadow-focus'
const CONTROL_COMPACT = 'px-13 py-7 focus-within:px-12 focus-within:py-6'
/** The filter bar's pill: 30px tall, so it lines up with the 30px chips beside it. */
const CONTROL_SM =
  'h-30 gap-8 px-12 py-0 [&_[data-slot=field-input]]:text-12-5/[normal] focus-within:px-11 focus-within:py-0'
const CONTROL_TEXTAREA = 'items-stretch'

const INPUT =
  'min-w-0 flex-[1_1_0] m-0 border-0 bg-transparent p-0 font-sans font-normal text-14/[normal] text-foreground outline-none placeholder:text-muted-foreground placeholder:opacity-100 disabled:text-muted-foreground'
const ICON = 'shrink-0 text-muted-foreground'

interface FieldFrame {
  /** `null` for a field labelled elsewhere (it then needs an `aria-label`): no empty label box. */
  label?: ReactNode
  /** Drawn under the control when there is one, and no line at all when there is not. */
  helper?: ReactNode
  error?: boolean | undefined
  className?: string | undefined
}

function Group({
  ui,
  id,
  label,
  helper,
  error,
  disabled,
  className,
  children,
}: FieldFrame & { ui: string; id: string; disabled?: boolean | undefined; children: ReactNode }) {
  return (
    <div
      data-ui={ui}
      data-slot="field"
      data-error={error || undefined}
      data-disabled={disabled || undefined}
      className={cx(FIELD, disabled && 'opacity-50', className)}
    >
      {label !== undefined && label !== null && (
        <label data-slot="field-label" className={LABEL} htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {hasHelper(helper) && (
        <div
          data-slot="field-helper"
          className={cx(HELPER, error && 'text-status-error-foreground')}
          id={`${id}-helper`}
        >
          {helper}
        </div>
      )}
    </div>
  )
}

/** The control's box, with the state the frames give it: what an error and a disabled field change. */
function controlClass(error: boolean | undefined, disabled: boolean | undefined, ...kind: Array<string | false>) {
  return cx(CONTROL, ...kind, disabled && 'bg-secondary', error && CONTROL_ERROR)
}

const iconClass = (error: boolean | undefined) => cx(ICON, error && 'text-destructive')

export interface InputGroupProps extends FieldFrame, Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  icon?: LucideIcon
}

export function InputGroup({ label, helper, error, className, icon, disabled, id, ...input }: InputGroupProps) {
  const generated = useId()
  const inputId = id ?? generated
  const Icon = error ? CircleAlert : icon
  return (
    <Group
      ui="Input Group"
      id={inputId}
      label={label}
      helper={helper}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div data-slot="field-control" data-control="input" className={controlClass(error, disabled)}>
        {Icon && <Icon data-slot="field-icon" className={iconClass(error)} size={16} aria-hidden />}
        <input
          id={inputId}
          data-slot="field-input"
          className={INPUT}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={helperId(inputId, helper)}
          {...input}
        />
      </div>
    </Group>
  )
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends FieldFrame, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: SelectOption[]
  /** A leading lucide icon before the value, as `InputGroup` has; an error swaps it for the alert. */
  icon?: LucideIcon
  /**
   * What the control leads with when the frame draws something that is not an icon: the ticket
   * modal's ASSIGNEE row puts the Employee's own tile there. Two screens built the whole field by
   * hand for want of this, in the kit's class names, which is exactly what stops working the day
   * those names carry nothing (T216).
   */
  lead?: ReactNode
  /** An adjustment for the leading icon, where a frame tints it — the priority flag's tone. */
  iconClassName?: string
}

export function Select({
  label,
  helper,
  error,
  className,
  options,
  icon,
  lead,
  iconClassName,
  disabled,
  id,
  ...select
}: SelectProps) {
  const generated = useId()
  const selectId = id ?? generated
  const Icon = error ? CircleAlert : icon
  return (
    <Group
      ui="Select"
      id={selectId}
      label={label}
      helper={helper}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div data-slot="field-control" data-control="select" className={controlClass(error, disabled, 'relative')}>
        {lead}
        {Icon && <Icon data-slot="field-icon" className={cx(iconClass(error), iconClassName)} size={16} aria-hidden />}
        <select
          id={selectId}
          data-slot="field-input"
          className={cx(
            INPUT,
            'cursor-pointer appearance-none [&>option]:bg-popover [&>option]:text-popover-foreground',
          )}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={helperId(selectId, helper)}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          data-slot="field-chevron"
          className={cx(iconClass(error), 'pointer-events-none')}
          size={16}
          aria-hidden
        />
      </div>
    </Group>
  )
}

export interface SearchProps extends FieldFrame, Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'> {
  shortcut?: string
  /**
   * `compact` is the 8px-padded search of the Top Bar and the table toolbar; `sm` is the 30px
   * pill a filter bar puts beside its 30px chips (design/html/activity.html:4437).
   */
  size?: 'md' | 'compact' | 'sm'
  /** `filled` is the flat 32px filter over a panel's own list, with no stroke around it. */
  tone?: 'outline' | 'filled'
}

const SEARCH_ICON: Record<NonNullable<SearchProps['size']>, number> = { md: 16, compact: 16, sm: 13 }

export function Search({
  label,
  helper,
  error,
  className,
  shortcut,
  size = 'md',
  tone = 'outline',
  disabled,
  id,
  ...input
}: SearchProps) {
  const generated = useId()
  const inputId = id ?? generated
  const control = (
    <div
      data-slot="field-control"
      data-control="search"
      data-tone={tone}
      data-size={size}
      /* `filled` before the two sizes, the order `field.css` declared them in: a small filled
         filter takes the size's 12.5px type, not the fill's 13px. */
      className={controlClass(
        error,
        disabled,
        CONTROL_SEARCH,
        tone === 'filled' && CONTROL_FILLED,
        size === 'compact' && CONTROL_COMPACT,
        size === 'sm' && CONTROL_SM,
      )}
    >
      {/* The filled filter draws a smaller glyph than any outlined size does. */}
      <SearchIcon
        data-slot="field-icon"
        className={iconClass(error)}
        size={tone === 'filled' ? 14 : SEARCH_ICON[size]}
        aria-hidden
      />
      <input
        id={inputId}
        type="search"
        data-slot="field-input"
        className={cx(INPUT, '[&::-webkit-search-cancel-button]:appearance-none')}
        disabled={disabled}
        aria-label={label === undefined ? (input.placeholder ?? 'Search') : undefined}
        {...input}
      />
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </div>
  )
  if (label === undefined && helper === undefined)
    return (
      <div data-ui="Search" data-slot="search" className={cx('flex min-w-0 flex-col', className)}>
        {control}
      </div>
    )
  return (
    <Group
      ui="Search"
      id={inputId}
      label={label}
      helper={helper}
      error={error}
      disabled={disabled}
      className={className}
    >
      {control}
    </Group>
  )
}

export interface TextareaProps extends FieldFrame, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

/**
 * The textarea sizes the control, never the other way round: a fixed height on the box let a taller
 * textarea — one given a `min-height`, or dragged by its resize grip — hang out of it. The designed
 * 82px is this 60px plus the control's 10px padding and 1px stroke, and focus keeps that total,
 * trading a padding pixel for the second border pixel.
 */
const TEXTAREA = 'h-60 min-h-60 resize-none leading-[21px]'

export function Textarea({ label, helper, error, className, disabled, id, ...textarea }: TextareaProps) {
  const generated = useId()
  const textareaId = id ?? generated
  return (
    <Group
      ui="Textarea"
      id={textareaId}
      label={label}
      helper={helper}
      error={error}
      disabled={disabled}
      className={className}
    >
      <div
        data-slot="field-control"
        data-control="textarea"
        className={controlClass(error, disabled, CONTROL_TEXTAREA)}
      >
        <textarea
          id={textareaId}
          data-slot="field-input"
          className={cx(INPUT, TEXTAREA)}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={helperId(textareaId, helper)}
          {...textarea}
        />
      </div>
    </Group>
  )
}
