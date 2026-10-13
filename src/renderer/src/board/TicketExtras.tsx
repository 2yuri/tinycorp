import { Flag, GitBranch, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  EPIC_COLORS,
  type EpicColor,
  labelColor,
  MAX_LABEL_LENGTH,
  normalizeLabels,
  PRIORITIES,
  PRIORITY_TITLES,
  type Priority,
} from '../../../shared/ticket-extras'
import { CHOICE_INPUT, cx, focusOnMount, InputGroup, Select } from '../ui'
import { FIELD_LABEL } from './RepoChips'

/** An epic's colour, or a label's. */
export const DOT_INK: Record<EpicColor, string> = {
  indigo: 'bg-primary',
  violet: 'bg-accent',
  green: 'bg-status-success-foreground',
  amber: 'bg-status-warning-foreground',
  red: 'bg-status-error-foreground',
  blue: 'bg-status-info-foreground',
}
/** The flag's tone: only high and urgent take a colour of their own. */
const PRIORITY_INK: Record<Priority, string> = {
  low: 'text-muted-foreground',
  normal: 'text-muted-foreground',
  high: 'text-status-warning-foreground',
  urgent: 'text-status-error-foreground',
}
/** A label chip: the frame's pill on `--secondary` with its 6px dot. */
const LABEL =
  'group/chip inline-flex max-w-full items-center rounded-full bg-secondary font-sans font-semibold leading-[normal] whitespace-nowrap text-foreground'
const LABEL_SIZE: Record<'sm' | 'md', string> = {
  md: 'gap-6 px-11 py-6 text-12',
  sm: 'gap-5 px-8 py-3 text-10-5',
}
/** The kit's field, with its value in the mono face the frame sets a branch name in. */
const BRANCH_FIELD = '[&_[data-slot=field-input]]:font-code [&_[data-slot=field-input]]:text-12-5/[inherit]'
/*
 * The chip's remove. The frame draws a label as its dot and its word, so the remove takes no width
 * until the chip is hovered or holds the focus — the resting row then reads as the frame does.
 * Both parents said this about their own subtree; the chip says it about itself.
 */
const LABEL_REMOVE =
  'm-0 -mr-3 inline-flex w-0 cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-muted-foreground opacity-0 group-hover/chip:w-auto group-hover/chip:opacity-100 group-focus-within/chip:w-auto group-focus-within/chip:opacity-100 hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
/** `+ Add label`: the frame's 6px 11px padding counts the 1px stroke, so the padding is 5/10. */
const LABEL_ADD =
  'm-0 inline-flex cursor-pointer items-center gap-5 rounded-full border border-border bg-transparent px-10 py-5 font-sans text-12/[normal] font-semibold text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
const LABEL_INPUT =
  'w-120 rounded-full border border-ring bg-card px-10 py-5 font-sans text-12/[normal] font-semibold text-foreground outline-none'
/** One epic-colour swatch; the focus ring comes from the radio it wraps. */
const SWATCH =
  'm-0 inline-flex size-24 cursor-pointer items-center justify-center rounded-full border bg-transparent p-0 has-[>[data-slot=choice-input]:focus-visible]:shadow-focus has-[>[data-slot=choice-input]:focus-visible]:outline-none'
/** A `<legend>`: the field label, with the margin both parents flatten to nothing. */
const LEGEND = cx(FIELD_LABEL, 'mb-0 p-0')

/** A small coloured dot: an epic's colour or a label's. */
export function ColorDot({ color, className }: { color: EpicColor | null; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-6 shrink-0 rounded-full',
        color ? DOT_INK[color] : 'bg-muted-foreground',
        className,
      )}
      aria-hidden
    />
  )
}

/** New Ticket › PRIORITY (design/html/new-ticket.html): a select led by a flag in the priority's tone. */
export function PriorityField({
  value,
  onChange,
  className,
}: {
  value: Priority
  onChange(priority: Priority): void
  /** The size its value reads at, which differs between the modal and the drawer. */
  className?: string
}) {
  const id = useId()
  return (
    <Select
      id={id}
      label="Priority"
      icon={Flag}
      iconClassName={PRIORITY_INK[value]}
      className={className}
      options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_TITLES[p] }))}
      value={value}
      onChange={(e) => onChange(e.target.value as Priority)}
    />
  )
}

/** New Ticket › BASE BRANCH: blank means each repo's default branch. */
export function BaseBranchField({ value, onChange }: { value: string; onChange(branch: string): void }) {
  return (
    <InputGroup
      label="Base branch"
      icon={GitBranch}
      className={BRANCH_FIELD}
      value={value}
      placeholder="Repo default"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** A label chip with its dot; removable in the editor. */
export function LabelChip({ label, size = 'md', onRemove }: { label: string; size?: 'sm' | 'md'; onRemove?(): void }) {
  return (
    <span className={cx(LABEL, LABEL_SIZE[size])}>
      <ColorDot color={labelColor(label)} />
      <span className="overflow-hidden text-ellipsis">{label}</span>
      {onRemove && (
        <button type="button" className={LABEL_REMOVE} aria-label={`Remove label ${label}`} onClick={onRemove}>
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}

/** New Ticket › LABELS: the chips and an "Add label" pill that opens an inline input. */
export function LabelsField({ value, onChange }: { value: string[]; onChange(labels: string[]): void }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    if (draft.trim()) onChange(normalizeLabels([...value, draft]))
    setDraft('')
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
      <legend className={LEGEND}>Labels</legend>
      <div className="flex flex-wrap items-center gap-8">
        {value.map((label) => (
          <LabelChip key={label} label={label} onRemove={() => onChange(value.filter((l) => l !== label))} />
        ))}
        {adding ? (
          <input
            className={LABEL_INPUT}
            aria-label="New label"
            ref={focusOnMount}
            maxLength={MAX_LABEL_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft('')
                setAdding(false)
              }
            }}
            onBlur={() => {
              commit()
              setAdding(false)
            }}
          />
        ) : (
          <button type="button" data-ui="AddLabel" className={LABEL_ADD} onClick={() => setAdding(true)}>
            <Plus size={12} aria-hidden />
            Add label
          </button>
        )}
      </div>
    </fieldset>
  )
}

/** The epic editor's colour swatches. */
export function EpicColorField({ value, onChange }: { value: EpicColor; onChange(color: EpicColor): void }) {
  const name = useId()
  return (
    <fieldset className="mx-0 mt-0 mb-12 flex min-w-0 flex-col gap-7 border-0 p-0">
      <legend className={LEGEND}>Colour</legend>
      <div className="flex flex-wrap items-center gap-8">
        {EPIC_COLORS.map((color) => (
          <label key={color} className={cx(SWATCH, value === color ? 'border-ring' : 'border-border')}>
            <input
              type="radio"
              data-slot="choice-input"
              className={CHOICE_INPUT}
              name={name}
              aria-label={color}
              checked={value === color}
              onChange={() => onChange(color)}
            />
            <ColorDot color={color} className="size-10" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The flag on a board card; nothing for normal priority. */
export function PriorityFlag({ priority }: { priority: Priority }) {
  if (priority === 'normal') return null
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-4 whitespace-nowrap font-sans font-semibold text-10-5/[inherit]',
        PRIORITY_INK[priority],
      )}
      title={`${PRIORITY_TITLES[priority]} priority`}
    >
      <Flag size={12} aria-hidden />
      <span>{PRIORITY_TITLES[priority]}</span>
    </span>
  )
}
