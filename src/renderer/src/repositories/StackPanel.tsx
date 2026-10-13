import { Check, Folder, X } from 'lucide-react'
import { useState } from 'react'
import type { RoleTemplate } from '../../../shared/domain/staff'
import { DEFAULT_RUNG, type RepoInspection, type RepoRung, type StackConstraints } from '../../../shared/repos/repo'
import { Alert, Button } from '../ui'
import { DetectedRemote } from './AddRepoModal'
import { BriefField, ChecksSection, RungField } from './RepoAbout'
import {
  CHOICE_INPUT,
  DIVIDER,
  FIELD,
  FIELD_HELPER,
  FIELD_LABEL,
  ICON_BUTTON,
  INPUT,
  INPUT_CONTROL_MONO,
  SPACER,
  TEXT_BUTTON_LG,
} from './repo-classes'
import { workingRoles } from './repo-view-model'

/*
 * The Add repository panel (step 2) and Define stack (T210c). Its stroke is drawn over the box on
 * the left edge only, which is what `.repo-panel::after { border-width: 0 0 0 1px }` said.
 */
const PANEL =
  'relative flex h-full w-424 shrink-0 flex-col bg-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-y-0 after:border-r-0 after:border-l after:border-border after:content-[""]'
const HEAD = 'flex h-64 w-full shrink-0 items-center gap-10 border-b border-border px-18 pt-1'
const TEXT = 'flex min-w-0 flex-1 flex-col gap-1'
const TITLE = 'text-foreground text-15/18 font-bold'
const SUB = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11/13 font-normal'
const FORM = 'm-0 flex min-h-0 flex-1 flex-col gap-14 overflow-auto p-18'
const ROLE_ROWS = 'flex w-full shrink-0 flex-col gap-8'
const ROLE_ROW = 'flex w-full flex-wrap items-center gap-8'
/* The role chips are labels over a real checkbox (T190). */
const ROLE =
  'm-0 inline-flex cursor-pointer items-center gap-6 rounded-full border-0 bg-secondary px-11 py-6 font-sans text-muted-foreground text-12/15 font-semibold has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
const ROLE_ON =
  'm-0 inline-flex cursor-pointer items-center gap-6 rounded-full border-0 bg-secondary px-11 py-6 font-sans text-foreground text-12/15 font-semibold has-[>input:focus-visible]:shadow-focus has-[>input:focus-visible]:outline-none'
const FOOTER = 'flex w-full shrink-0 items-center gap-10 border-t border-border px-18 pt-13 pb-14'

export interface StackPanelProps {
  mode: 'add' | 'edit'
  /** The repo's display name; the panel subtitle when editing. */
  name: string
  path: string
  inspection: RepoInspection | null
  initialBrief: string
  initialStack: StackConstraints
  /** What TinyCorp may do here; `merges` for a repo being attached. */
  initialRung?: RepoRung
  roles: RoleTemplate[]
  initialAllowed: ReadonlySet<string>
  error: string | null
  busy: boolean
  onCancel(): void
  onSave(values: { brief: string; stack: StackConstraints; allowed: Set<string>; rung: RepoRung }): void
}

/**
 * Add repository, step 2 of 2 (and Edit repository): the brief every Employee reads, the optional
 * Checks they run before a PR, and who may work here.
 */
export function StackPanel(props: StackPanelProps) {
  const [brief, setBrief] = useState(props.initialBrief)
  const [stack, setStack] = useState(props.initialStack)
  const [allowed, setAllowed] = useState(() => new Set(props.initialAllowed))
  const [rung, setRung] = useState<RepoRung>(props.initialRung ?? DEFAULT_RUNG)
  const set = (changes: Partial<StackConstraints>) => setStack((current) => ({ ...current, ...changes }))

  const roles = workingRoles(props.roles)
  const checked = roles.filter((role) => allowed.has(role.id))
  const unchecked = roles.filter((role) => !allowed.has(role.id))
  const toggle = (id: string) =>
    setAllowed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <aside className={PANEL} data-repo-panel aria-label={props.mode === 'add' ? 'Add repository' : 'Edit repository'}>
      <header className={HEAD}>
        <div className={TEXT}>
          <div className={TITLE}>{props.mode === 'add' ? 'Add repository' : 'Edit repository'}</div>
          <div className={SUB}>{props.mode === 'add' ? 'Step 2 of 2 · About' : `${props.name} · About`}</div>
        </div>
        <button type="button" className={ICON_BUTTON} aria-label="Close" onClick={props.onCancel}>
          <X size={17} aria-hidden />
        </button>
      </header>

      <form
        id="repo-stack-form"
        className={FORM}
        onSubmit={(event) => {
          event.preventDefault()
          props.onSave({ brief, stack, allowed, rung })
        }}
      >
        {props.error && <Alert variant="error" title={props.error} />}

        <div className={FIELD}>
          <span className={FIELD_LABEL}>LOCAL PATH</span>
          <span className={INPUT} title={props.path}>
            <Folder size={14} aria-hidden />
            <span className={INPUT_CONTROL_MONO}>{props.path}</span>
          </span>
          <span className={FIELD_HELPER}>Worktrees are created outside this folder, one per ticket.</span>
        </div>

        <DetectedRemote inspection={props.inspection} path={props.path} compact />

        <div className={DIVIDER} />

        <BriefField value={brief} onChange={setBrief} />

        <RungField value={rung} onChange={setRung} />

        <ChecksSection
          stack={stack}
          onChange={set}
          detected={props.inspection?.detected}
          defaultOpen={props.mode === 'edit' ? true : undefined}
        />

        <div className={DIVIDER} />

        <span className={FIELD_LABEL}>WHO CAN WORK HERE</span>
        <div className={ROLE_ROWS}>
          {[checked, unchecked].map(
            (row, index) =>
              row.length > 0 && (
                <div className={ROLE_ROW} key={index}>
                  {row.map((role) => (
                    <label key={role.id} className={allowed.has(role.id) ? ROLE_ON : ROLE}>
                      <input
                        type="checkbox"
                        className={CHOICE_INPUT}
                        checked={allowed.has(role.id)}
                        onChange={() => toggle(role.id)}
                      />
                      {allowed.has(role.id) && <Check size={12} aria-hidden />}
                      {role.name}
                    </label>
                  ))}
                </div>
              ),
          )}
        </div>
      </form>

      <footer className={FOOTER}>
        <button type="button" className={TEXT_BUTTON_LG} onClick={props.onCancel}>
          Cancel
        </button>
        <span className={SPACER} />
        <Button type="submit" form="repo-stack-form" icon={Check} disabled={props.busy}>
          {props.mode === 'add' ? 'Add repository' : 'Save'}
        </Button>
      </footer>
    </aside>
  )
}
