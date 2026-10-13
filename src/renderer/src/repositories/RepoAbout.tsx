import { ChevronDown, Package, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import {
  BRIEF_PLACEHOLDER,
  hasChecks,
  REPO_RUNGS,
  type RepoRung,
  RUNG_HELP,
  RUNG_LABEL,
  type StackConstraints,
} from '../../../shared/repos/repo'
import { RUNG_ICON } from './RepoCard'
import {
  CHOICE_INPUT,
  DETECTED,
  FIELD,
  FIELD_GROW,
  FIELD_HELPER,
  FIELD_LABEL,
  INPUT,
  INPUT_CONTROL_MONO,
  INPUT_SELECT,
  ROW,
  RUNG_OPTION,
  RUNG_OPTION_ON,
  RUNG_OPTION_SUB,
  RUNG_OPTION_TITLE,
  RUNGS,
  SPACER,
  STACK_HEADER,
  STACK_HEADER_TITLE,
  STACK_HELP,
} from './repo-classes'
import {
  COMMAND_KEYS,
  type CommandKey,
  managerValue,
  packageManagerOptions,
  parseManagerValue,
} from './repo-view-model'

import '../ui/tailwind.css'

/*
 * Brief and optional Checks (decision 40, T210c). The brief's box is a textarea the boss can drag
 * taller, which is why it keeps `resize-y` and a min-height rather than a fixed one.
 */
/* Compact closes the gap under the label from 6 to 5, so both are written out: `FIELD` carries a
   gap of its own and two of them would leave the winner to Tailwind's output order. */
const BRIEF = 'flex w-full min-w-0 shrink-0 flex-col gap-6'
const BRIEF_COMPACT = 'flex w-full min-w-0 shrink-0 flex-col gap-5'
const BRIEF_INPUT =
  'min-h-60 w-full min-w-0 resize-y rounded-sm border border-border bg-card px-11 py-9 font-sans text-foreground text-13/19 placeholder:text-muted-foreground focus:border-ring focus:shadow-focus focus:outline-none'
const BRIEF_INPUT_COMPACT =
  'min-h-36 w-full min-w-0 resize-y rounded-sm border border-border bg-card px-10 py-7 font-sans text-foreground text-12-5/18 placeholder:text-muted-foreground focus:border-ring focus:shadow-focus focus:outline-none'
const BRIEF_LABEL = 'text-muted-foreground text-11-5/14 font-medium'
const CHECKS = 'flex w-full shrink-0 flex-col gap-12'
const CHECKS_TOGGLE =
  'm-0 inline-flex cursor-pointer items-center gap-8 border-0 bg-transparent p-0 font-sans text-[length:inherit] text-inherit'
const CHEVRON = '-rotate-90 text-muted-foreground transition-transform duration-120 ease-[ease]'
const CHEVRON_OPEN = 'rotate-0 text-muted-foreground transition-transform duration-120 ease-[ease]'
const OPTIONAL_PILL =
  'inline-flex items-center rounded-full bg-secondary px-9 py-3 text-foreground text-10-5/13 font-semibold'

const COMMAND_LABEL: Record<CommandKey, string> = { install: 'INSTALL', build: 'BUILD', test: 'TEST', lint: 'LINT' }

/** "About this repo": the free-text brief every Employee reads (decision 40). */
export function BriefField(props: {
  value: string
  onChange(value: string): void
  /** The field label; `ABOUT THIS REPO` by default. */
  label?: string
  /** Hides the helper line and uses a shorter box, for list rows. */
  compact?: boolean
  rows?: number
}) {
  return (
    <label className={props.compact ? BRIEF_COMPACT : BRIEF}>
      <span className={props.compact ? BRIEF_LABEL : FIELD_LABEL}>{props.label ?? 'ABOUT THIS REPO'}</span>
      <textarea
        className={props.compact ? BRIEF_INPUT_COMPACT : BRIEF_INPUT}
        aria-label="Brief"
        value={props.value}
        rows={props.rows ?? (props.compact ? 2 : 3)}
        placeholder={BRIEF_PLACEHOLDER}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {!props.compact && (
        <span className={FIELD_HELPER}>Every Employee reads this. Stack preferences, or let the team decide.</span>
      )}
    </label>
  )
}

/**
 * What TinyCorp may do to this repo (decision 61). Picked when the repo is attached, which is when
 * the boss knows, and changed later here or from the card's `…` menu. The engine refuses against
 * it; this is only where it is said.
 */
export function RungField(props: { value: RepoRung; onChange(rung: RepoRung): void }) {
  const name = useId()
  return (
    <div className={FIELD}>
      <span className={FIELD_LABEL}>WHAT TINYCORP MAY DO HERE</span>
      <div className={RUNGS} role="radiogroup" aria-label="What TinyCorp may do here">
        {REPO_RUNGS.map((rung) => {
          const Icon = RUNG_ICON[rung]
          const on = props.value === rung
          return (
            <label key={rung} className={on ? RUNG_OPTION_ON : RUNG_OPTION} data-rung-option data-on={on || undefined}>
              <input
                type="radio"
                className={CHOICE_INPUT}
                name={name}
                checked={on}
                onChange={() => props.onChange(rung)}
              />
              <Icon size={14} aria-hidden />
              <span className={RUNG_OPTION_TITLE} data-rung-title>
                {RUNG_LABEL[rung]}
              </span>
              <span className={RUNG_OPTION_SUB}>{RUNG_HELP[rung]}</span>
            </label>
          )
        })}
      </div>
      <span className={FIELD_HELPER}>
        The Company’s autonomy level says when TinyCorp asks you. This says what it may do at all, and it wins.
      </span>
    </div>
  )
}

/**
 * The optional Checks: package manager and the install, build, test and lint commands run before
 * every PR. Collapsed until something is set; `detected` fills them in on request.
 */
export function ChecksSection(props: {
  stack: StackConstraints
  onChange(changes: Partial<StackConstraints>): void
  detected?: Partial<StackConstraints> | undefined
  /** Open at first; by default only when something is set. */
  defaultOpen?: boolean | undefined
}) {
  const [open, setOpen] = useState(
    () => props.defaultOpen ?? (hasChecks(props.stack) || props.stack.packageManager !== ''),
  )
  const detected = props.detected ?? {}
  const canDetect = Object.keys(detected).length > 0
  const { stack } = props

  return (
    <section className={CHECKS} aria-label="Checks (optional)">
      <div className={STACK_HEADER}>
        <button type="button" className={CHECKS_TOGGLE} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span className={STACK_HEADER_TITLE}>Checks</span>
          <span className={OPTIONAL_PILL}>Optional</span>
          <ChevronDown size={14} aria-hidden className={open ? CHEVRON_OPEN : CHEVRON} />
        </button>
        <span className={SPACER} />
        <button
          type="button"
          className={DETECTED}
          disabled={!canDetect}
          title={canDetect ? 'Fill in what was detected in the folder' : 'Nothing detected in this folder'}
          onClick={() => {
            props.onChange(detected)
            setOpen(true)
          }}
        >
          <Sparkles size={13} aria-hidden />
          Detected
        </button>
      </div>
      <p className={STACK_HELP}>Run before every PR. Empty is fine until someone sets them.</p>

      {open && (
        <>
          <label className={FIELD}>
            <span className={FIELD_LABEL}>PACKAGE MANAGER</span>
            <span className={INPUT}>
              <Package size={14} aria-hidden />
              <select
                className={INPUT_SELECT}
                value={managerValue(stack.packageManager, stack.packageManagerVersion)}
                onChange={(event) => props.onChange(parseManagerValue(event.target.value))}
              >
                {packageManagerOptions(stack).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </span>
          </label>

          {[COMMAND_KEYS.slice(0, 2), COMMAND_KEYS.slice(2)].map((pair) => (
            <div className={ROW} key={pair.join()}>
              {pair.map((key) => (
                <label className={FIELD_GROW} key={key}>
                  <span className={FIELD_LABEL}>{COMMAND_LABEL[key]}</span>
                  <span className={INPUT}>
                    <input
                      className={INPUT_CONTROL_MONO}
                      value={stack[key]}
                      spellCheck={false}
                      onChange={(event) => props.onChange({ [key]: event.target.value })}
                    />
                  </span>
                </label>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
