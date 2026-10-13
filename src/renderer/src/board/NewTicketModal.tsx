import { Plus, User, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { enterKey } from '../../../shared/app/shortcuts'
import type { AutonomyLevel } from '../../../shared/approvals'
import { type BoardCommand, type BoardSnapshot, COLUMN_TITLES, type Column } from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import type { Repo } from '../../../shared/repos/repo'
import type { Priority } from '../../../shared/ticket-extras'
import { hostPlatform, modifierLabel } from '../chrome'
import { Alert, Avatar, Button, cx, IconButton, InputGroup, Kbd, Select, Textarea, Toggle } from '../ui'
import { newTicketInput, startWorkNote, type TicketDraft } from './new-ticket-model'
import { RepoChips } from './RepoChips'
import { initialRepoScope, repoScopeError } from './repo-scope'
import { BaseBranchField, LabelsField, PriorityField } from './TicketExtras'

export interface NewTicketModalProps {
  /** The board the ticket joins; only its epics are read, to keep a scoped epic. */
  board: BoardSnapshot
  /** The column the action was taken in — the header line names it. */
  column: Column
  /** The epic the board is scoped to, or null. */
  epicId: number | null
  /** The Company's repos, to pick a ticket's scope from. */
  repos: Repo[]
  /** The Company's Employees, to assign the ticket to. */
  employees: Employee[]
  /** The Company's name, which the header line starts with. */
  companyName: string
  /** `Start work immediately` is hidden under Supervised (decision 38); null while it is unknown. */
  autonomy: AutonomyLevel | null
  apply(command: BoardCommand): Promise<boolean>
  error: string | null
  onClose(): void
}

/**
 * New ticket (design `Y5daiS`): a centred 640px modal over a backdrop that fills the window under
 * the title bar — a header bar, the fields in the frame's order, and a footer bar that says `⌘↵ to
 * create` beside `Cancel` and `Create ticket`. Escape and the backdrop close it; `⌘↵` creates from
 * wherever the caret is.
 */
/*
 * The modal dresses the kit's fields the way frame `Y5daiS` draws them, and says so from its own
 * root exactly as the stylesheet did. `\_` for each BEM underscore — a bare `_` is how Tailwind
 * writes a space — and `', because Tailwind reads this file rather than the runtime.
 */
export const MODAL_FIELDS =
  '[&_[data-slot=field]]:gap-6 [&_[data-slot=field-label]]:m-0 [&_[data-slot=field-label]]:font-sans [&_[data-slot=field-label]]:text-11/[normal] [&_[data-slot=field-label]]:font-bold [&_[data-slot=field-label]]:tracking-[0.5px] [&_[data-slot=field-label]]:whitespace-nowrap [&_[data-slot=field-label]]:text-muted-foreground [&_[data-slot=field-label]]:uppercase [&_[data-slot=field-control]:not([data-control=textarea])]:h-40 [&_[data-slot=field-control]:not([data-control=textarea])]:gap-9 [&_[data-slot=field-control]:not([data-control=textarea])]:px-12 [&_[data-slot=field-control]:not([data-control=textarea])]:py-0 [&_[data-slot=field-control]:not([data-control=textarea]):focus-within]:px-11 [&_[data-control=textarea]]:px-12 [&_[data-control=textarea]]:py-10 [&_[data-control=textarea]:focus-within]:px-11 [&_[data-control=textarea]:focus-within]:py-9 [&_[data-control=textarea]_textarea]:resize-y [&_[data-control=textarea]_textarea]:text-12-5/19'

/** The backdrop fills the window under the 44px title bar, so the window's buttons stay its own. */
const BACKDROP =
  'fixed inset-x-0 top-44 bottom-0 z-30 flex items-center justify-center bg-scrim p-24 font-sans leading-[normal]'
/** The frame's 640px card. */
const MODAL = 'flex max-h-full w-640 max-w-full flex-col rounded-md border border-border bg-card shadow-modal'
/** The frame sets the modal's select at 13.5; the assignee beside it reads at 13. */
const PRIORITY_SIZE = '[&_[data-slot=field-input]]:text-13-5/[inherit]'
/** ASSIGNEE: the tile beside the name draws the row wider than a glyph would, hence the 8px gap. */
const ASSIGNEE_FIELD = '[&_[data-slot=field-control]]:gap-8 [&_[data-slot=field-input]]:text-13/[inherit]'
/** The two 13.5px buttons in the foot. */
const FOOT_BUTTON = 'px-16 py-9 text-13-5/[inherit]'
/** The frame draws each key as a cap: a hairline box round the mono glyph. */
const KEY_CAPS =
  '[&_[data-slot=kbd]]:inline-flex [&_[data-slot=kbd]]:items-center [&_[data-slot=kbd]]:justify-center [&_[data-slot=kbd]]:rounded-[6px] [&_[data-slot=kbd]]:border [&_[data-slot=kbd]]:border-hairline [&_[data-slot=kbd]]:px-7 [&_[data-slot=kbd]]:py-3 [&_[data-slot=kbd]]:font-semibold'

export function NewTicketModal(props: NewTicketModalProps) {
  const formId = useId()
  const close = useRef(props.onClose)
  close.current = props.onClose

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  // Null until the boss picks, so the chips follow the repos list as it loads.
  const [picked, setPicked] = useState<string[] | null>(null)
  const repos = picked ?? initialRepoScope(props.repos, null)
  const [showRepoError, setShowRepoError] = useState(false)
  const [priority, setPriority] = useState<Priority>('normal')
  const [labels, setLabels] = useState<string[]>([])
  const [baseBranch, setBaseBranch] = useState('')
  const [startNow, setStartNow] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
        return
      }
      // The footer's promise: ⌘↵ creates from wherever the caret is.
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      const form = document.getElementById(formId)
      if (form instanceof HTMLFormElement) {
        event.preventDefault()
        form.requestSubmit()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [formId])

  // Supervised gates starting work (decision 6), so the row is not offered there at all.
  const canStartNow = props.autonomy !== null && props.autonomy !== 'supervised'
  const assignee = props.employees.find((e) => e.id === assigneeId) ?? null
  const draft: TicketDraft = {
    title,
    description,
    column: props.column,
    epicId: props.epicId,
    assigneeId,
    repos,
    priority,
    labels,
    baseBranch,
    startNow: startNow && canStartNow,
  }

  async function submit() {
    if (repoScopeError(repos)) {
      setShowRepoError(true)
      return
    }
    const ok = await props.apply({ kind: 'createTicket', input: newTicketInput(draft) })
    if (ok) props.onClose()
  }

  return (
    <div
      data-ui="NewTicket"
      className={cx(BACKDROP, MODAL_FIELDS)}
      onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div className={MODAL} role="dialog" aria-modal="true" aria-label="New ticket">
        <header className="flex shrink-0 items-center gap-12 border-border border-b px-20 py-16">
          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-2">
            <h3 className="m-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold text-16/19 text-foreground">
              New ticket
            </h3>
            <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-11-5/14 text-muted-foreground">
              {[props.companyName, 'Board', COLUMN_TITLES[props.column]].join(' · ')}
            </p>
          </div>
          <IconButton icon={X} label="Close" size="sm" iconSize={17} className="shrink-0" onClick={props.onClose} />
        </header>

        <form
          id={formId}
          className="flex min-h-0 flex-[0_1_auto] flex-col gap-14 overflow-y-auto px-20 py-16"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {props.error && <Alert variant="error" title={props.error} />}
          <InputGroup label="Title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex items-start gap-12 [&>*]:min-w-0 [&>*]:flex-[1_1_0]">
            <RepoChips
              repos={props.repos}
              selected={repos}
              onChange={setPicked}
              error={showRepoError ? repoScopeError(repos) : null}
            />
            <BaseBranchField value={baseBranch} onChange={setBaseBranch} />
          </div>
          <div className="flex items-start gap-12 [&>*]:min-w-0 [&>*]:flex-[1_1_0]">
            <AssigneeField employees={props.employees} value={assigneeId} onChange={setAssigneeId} />
            <PriorityField value={priority} onChange={setPriority} className={PRIORITY_SIZE} />
          </div>
          <LabelsField value={labels} onChange={setLabels} />
          {canStartNow && (
            <>
              <div data-ui="Divider" className="h-1 w-full shrink-0 bg-border" />
              <div data-ui="StartWork" className="flex shrink-0 items-center gap-16">
                <div className="flex min-w-0 flex-[1_1_0] flex-col gap-2">
                  <span className="font-semibold text-13-5/[inherit] text-foreground">Start work immediately</span>
                  <span className="font-normal text-11-5/17 text-muted-foreground">
                    {startWorkNote(assignee?.name ?? null, baseBranch)}
                  </span>
                </div>
                <Toggle
                  label=""
                  aria-label="Start work immediately"
                  className={'[&_[data-slot=choice-label]]:hidden'}
                  checked={startNow}
                  disabled={assignee === null}
                  onChange={(e) => setStartNow(e.target.checked)}
                />
              </div>
            </>
          )}
        </form>

        <footer className="flex shrink-0 items-center gap-10 border-border border-t px-20 py-14">
          <span className={cx('flex flex-[1_1_0] items-center gap-6', KEY_CAPS)}>
            <Kbd>{modifierLabel()}</Kbd>
            <Kbd>{enterKey(hostPlatform())}</Kbd>
            <span className="font-normal text-11-5/[inherit] text-muted-foreground">to create</span>
          </span>
          <Button variant="ghost" className={FOOT_BUTTON} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} icon={Plus} className={FOOT_BUTTON}>
            Create ticket
          </Button>
        </footer>
      </div>
    </div>
  )
}

/** ASSIGNEE: the frame's select, led by the Employee's own tile instead of a generic icon. */
function AssigneeField(props: { employees: Employee[]; value: string; onChange(id: string): void }) {
  const id = useId()
  const picked = props.employees.find((e) => e.id === props.value) ?? null
  return (
    <Select
      id={id}
      label="Assignee"
      className={ASSIGNEE_FIELD}
      lead={picked ? <Avatar name={picked.name} size={24} person={{ id: picked.id, sprite: picked.sprite }} /> : null}
      {...(picked ? {} : { icon: User })}
      options={[
        { value: '', label: 'Unclaimed' },
        ...props.employees.map((employee) => ({
          value: employee.id,
          label: `${employee.name} · ${employee.title}`,
        })),
      ]}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}
