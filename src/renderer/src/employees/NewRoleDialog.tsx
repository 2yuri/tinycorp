import { Check, FilePlus, Info, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CANCEL,
  CLOSE,
  ERROR,
  FIELD,
  FOOTER,
  FORM,
  HEADER,
  HEADER_TEXT,
  LABEL,
  MODAL,
  NOTE,
  NOTE_TEXT,
  OVERLAY,
  roleIcon,
  SUBMIT,
  SUBTITLE,
  TITLE,
} from '../hiring'
import { cx } from '../ui'
import { BLANK_ROLE, type RoleChoice } from './roles-model'
import '../ui/tailwind.css'

/**
 * New role, frame `s1iawl`: pick a built-in template or start blank (T240).
 *
 * It only picks. What the role *is* is settled in the editor it opens, which is the same editor
 * that edits a role that has been in the Company for months — there is one role form, not two.
 */
export function NewRoleDialog(props: {
  choices: RoleChoice[]
  error: string | null
  onCancel(): void
  onCreate(choice: RoleChoice): void
}) {
  const [picked, setPicked] = useState<RoleChoice>(props.choices[0] ?? BLANK_ROLE)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  return createPortal(
    <div
      data-ui="Modal Overlay"
      className={OVERLAY}
      onPointerDown={(event) => event.target === event.currentTarget && props.onCancel()}
    >
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label="New role"
        onSubmit={(event) => {
          event.preventDefault()
          props.onCreate(picked)
        }}
      >
        <header className={HEADER}>
          <div className={HEADER_TEXT}>
            <div data-ui="Modal Title" className={TITLE}>
              New role
            </div>
            <div data-ui="Modal Subtitle" className={SUBTITLE}>
              Start from a built-in template, or from nothing
            </div>
          </div>
          <button type="button" className={CLOSE} aria-label="Close" onClick={props.onCancel}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div data-ui="Modal Form" className={FORM}>
          <div data-ui="Field" className={FIELD}>
            <span data-ui="Field Label" className={LABEL} id="new-role-label">
              TEMPLATE
            </span>
            <div className={GRID} role="radiogroup" aria-labelledby="new-role-label">
              {props.choices.map((choice) => {
                const key = choice.templateId ?? 'blank'
                const on = key === (picked.templateId ?? 'blank')
                const Icon = choice.templateId === null ? FilePlus : roleIcon(choice.name)
                return (
                  <label
                    key={key}
                    data-ui="Template"
                    data-state={on ? 'on' : 'off'}
                    // The blank role is the last card and takes the whole row: it is not one of them.
                    className={cx(CARD, on ? CARD_ON : CARD_OFF, choice.templateId === null && 'col-span-3')}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name="new-role-template"
                      checked={on}
                      onChange={() => setPicked(choice)}
                    />
                    <span className="flex w-full items-center gap-7">
                      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 basis-0 truncate font-semibold text-12-5/normal text-foreground">
                        {choice.name}
                      </span>
                      {choice.inCompany && <span className={TAG}>In this Company</span>}
                      {on && <Check size={14} className="shrink-0 text-primary" aria-hidden />}
                    </span>
                    <span className="font-normal text-11/16 text-muted-foreground">{choice.description}</span>
                    {choice.meta && (
                      <span className="truncate font-code text-10/normal text-muted-foreground">{choice.meta}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
          {props.error && (
            <p className={ERROR} role="alert">
              {props.error}
            </p>
          )}
        </div>

        <footer className={FOOTER}>
          <span className={NOTE}>
            <Info size={14} aria-hidden />
            <span data-ui="Modal Note" className={NOTE_TEXT}>
              The role opens in the editor so you can change it before anyone is hired.
            </span>
          </span>
          <button type="button" className={CANCEL} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className={SUBMIT}>
            <Plus size={15} aria-hidden />
            {picked.templateId === null ? 'Create role' : `Create ${picked.name}`}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

const GRID = 'grid w-full grid-cols-3 gap-10'

const CARD = 'flex cursor-pointer flex-col items-start gap-5 rounded-md border p-10 [font:inherit]'

const CARD_OFF = 'border-input bg-muted'

const CARD_ON = 'border-primary bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]'

const TAG = 'rounded-full bg-secondary px-7 py-2 font-semibold text-9-5/normal text-muted-foreground'
