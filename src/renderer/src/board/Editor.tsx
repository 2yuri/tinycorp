import { Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useReducer, useRef, useState } from 'react'
import {
  type BoardCommand,
  type BoardSnapshot,
  COLUMN_TITLES,
  COLUMNS,
  type Column,
  type Ticket,
} from '../../../shared/domain/board'
import type { Employee } from '../../../shared/domain/staff'
import type { Repo } from '../../../shared/repos/repo'
import { canOpenReview } from '../../../shared/review/review-entry'
import { defaultEpicColor, type EpicColor } from '../../../shared/ticket-extras'
import { DELETE_TICKET_ACTION } from '../../../shared/ticket-removal'
import { shortcutLabel } from '../chrome'
import { TicketCode } from '../code'
import { TicketRestorePoints } from '../restore'
import { TicketReview } from '../review'
import { Alert, Button, Checkbox, cx, focusOnMount, IconButton, InputGroup, Select, Textarea, Toggle } from '../ui'
import { type BoardFacts, codeOf, latestReview, ticketLabel } from './board-model'
import { useTicketDelete } from './DeleteTicket'
import { MODAL_FIELDS } from './NewTicketModal'
import { RepoChips } from './RepoChips'
import { initialRepoScope, repoScopeError } from './repo-scope'
import { BaseBranchField, EpicColorField, LabelsField, PriorityField } from './TicketExtras'
import { BlockedBy } from './TicketLinks'
import { TicketPlan } from './TicketPlan'
import { patchDraft, type TicketDraft, ticketChanges, ticketDraft } from './ticket-form'

export type Editing =
  | { kind: 'target'; id: number | null }
  | { kind: 'epic'; id: number | null }
  | { kind: 'ticket'; id: number }

interface EditorProps {
  board: BoardSnapshot
  editing: Editing
  apply(command: BoardCommand): Promise<boolean>
  /** The Company's repos, to pick a ticket's scope from. */
  repos: Repo[]
  repoName(id: string): string
  /** The Company's Employees, to assign a ticket to. */
  employees: Employee[]
  /** What the board already reads to decorate its cards; the drawer's Code and Review read it too. */
  facts: BoardFacts
  /** The Company's name, which the drawer's header line starts with. */
  companyName: string
  error: string | null
  onClose(): void
}

/** What the drawer's header says and what its footer's button does, per kind of item. */
interface Heading {
  title: ReactNode
  sub: string
  /** The footer button's label, or empty when there is nothing to save. */
  save: string
}

/**
 * The ticket drawer (design `Izdc9`): 440px over a scrim across the board, under the title bar,
 * with a fixed header, a scrolling body and a fixed footer. The close lives in the header, so it
 * survives scrolling; `⌘↵` saves and `Esc` closes, both through the same leave path as the buttons.
 * A ticket that does not exist yet is not here: New ticket is the frame's own modal
 * (`NewTicketModal`, design `Y5daiS`).
 */
/** The drawer's 440px panel, thrown over the board with the frame's sideways shadow. */
const SELECT_13 = '[&_[data-control=select]_[data-slot=field-input]]:text-13/[inherit]'
const DRAWER =
  'relative flex h-full w-[min(440px,100vw)] flex-col overflow-hidden border-l border-border bg-card font-sans shadow-drawer'
/** Every section label in the drawer — the fields' own and the two sections' — is the modal's. */
const SECTION_LABEL =
  'm-0 font-sans text-11/[normal] font-bold tracking-[0.5px] whitespace-nowrap text-muted-foreground uppercase'
/** A subtask's title, which is an input that reads as text until it is typed in. */
/*
 * Hidden until hover or focus, and no height even then: the kit's 30px icon button would otherwise
 * box every row to 30px where frame `Izdc9` is the checkbox's 18. `Editor.test.tsx` holds it to
 * `h-0` and `opacity-0`, which is what the row's height depends on.
 */
/** The checkbox carries no label of its own, and an empty one still takes a box. */
const SUBTASK_ROW = 'group/subtask flex items-center gap-10 [&_[data-slot=choice-label]:empty]:hidden'
export const SUBTASK_TOOLS =
  'flex h-0 shrink-0 items-center gap-4 opacity-0 group-hover/subtask:opacity-100 group-focus-within/subtask:opacity-100'
const SUBTASK_TITLE =
  'm-0 min-w-0 flex-[1_1_0] border-0 bg-transparent p-0 font-sans text-14/[normal] font-normal outline-none'

export function Editor(props: EditorProps) {
  const { editing } = props
  // Keyed so each item gets fresh form state.
  const key = `${editing.kind}:${editing.id}`
  const formId = useId()
  const close = useRef(props.onClose)
  close.current = props.onClose

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
        return
      }
      // The footer's promise: ⌘↵ saves from wherever the caret is, as long as there is a form.
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

  const ticket = editing.kind === 'ticket' ? props.board.tickets.find((t) => t.id === editing.id) : undefined
  const heading = headingOf(props, ticket)
  const deletion = useTicketDelete(props.onClose)

  return (
    <div className="fixed inset-x-0 top-44 bottom-0 z-30 flex justify-end">
      <div data-ui="Scrim" className="absolute inset-0 bg-scrim-soft" aria-hidden />
      <aside className={cx(DRAWER, MODAL_FIELDS, SELECT_13)} aria-label="Board editor">
        <header className="flex shrink-0 items-center gap-12 border-border border-b px-20 py-16">
          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-2">
            <h3 className="m-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold text-16/19 text-foreground">
              {heading.title}
            </h3>
            <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-11-5/14 text-muted-foreground">
              {heading.sub}
            </p>
          </div>
          <IconButton icon={X} label="Close" size="sm" className="shrink-0" onClick={props.onClose} />
        </header>
        <div data-ui="DrawerBody" className="flex min-h-0 flex-[1_1_0] flex-col gap-7 overflow-y-auto p-14">
          {props.error && <Alert variant="error" title={props.error} />}
          {deletion.refusal && <Alert variant="error" title={deletion.refusal} onClose={deletion.dismissRefusal} />}
          {editing.kind === 'target' && <TargetForm key={key} {...props} formId={formId} id={editing.id} />}
          {editing.kind === 'epic' && <EpicForm key={key} {...props} formId={formId} id={editing.id} />}
          {editing.kind === 'ticket' &&
            (ticket ? (
              <TicketEditor key={key} {...props} formId={formId} ticket={ticket} />
            ) : (
              <p className="m-0 text-12/[inherit] text-muted-foreground">This ticket no longer exists.</p>
            ))}
        </div>
        <footer className="flex shrink-0 items-center gap-12 border-border border-t px-20 py-14">
          {/* Only a ticket is deleted from here, and the push-back is on the left (T275, frame `eKZNK`). */}
          {ticket && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                className="gap-7 text-destructive"
                onClick={() => deletion.ask(ticket.id)}
              >
                {DELETE_TICKET_ACTION}
              </Button>
              <span className="flex-[1_1_0]" />
            </>
          )}
          {/* A ticket that is gone has no form, so the footer has nothing to promise. */}
          {heading.save && (
            <span className={cx('text-11-5/[normal] text-muted-foreground', !ticket && 'flex-[1_1_0]')}>
              {shortcutLabel('↵')} to save
            </span>
          )}
          {heading.save && (
            <Button type="submit" form={formId}>
              {heading.save}
            </Button>
          )}
        </footer>
      </aside>
      {deletion.overlay}
    </div>
  )
}

/** `TC-142 Ticket` over `Tiny Corp · Board · Doing · Ada Lorne`, as the frame reads it. */
function headingOf(props: EditorProps, ticket: Ticket | undefined): Heading {
  const { editing } = props
  const trail = [props.companyName, 'Board']
  switch (editing.kind) {
    case 'target': {
      const target = props.board.targets.find((t) => t.id === editing.id)
      return { title: target ? 'Target' : 'New target', sub: trail.join(' · '), save: target ? 'Save' : 'Create' }
    }
    case 'epic': {
      const epic = props.board.epics.find((e) => e.id === editing.id)
      return { title: epic ? 'Epic' : 'New epic', sub: trail.join(' · '), save: epic ? 'Save' : 'Create' }
    }
    case 'ticket': {
      if (!ticket) return { title: `${ticketLabel(editing.id, props.facts)} Ticket`, sub: trail.join(' · '), save: '' }
      const assignee = ticket.assigneeId
        ? (props.employees.find((e) => e.id === ticket.assigneeId)?.name ?? ticket.assigneeId)
        : 'Unclaimed'
      return {
        title: `${ticketLabel(ticket.id, props.facts)} Ticket`,
        sub: [...trail, COLUMN_TITLES[ticket.column], assignee].join(' · '),
        save: 'Save',
      }
    }
  }
}

type FormProps = EditorProps & { formId: string }

function TargetForm(props: FormProps & { id: number | null }) {
  const target = props.board.targets.find((t) => t.id === props.id)
  const [title, setTitle] = useState(target?.title ?? '')
  const [description, setDescription] = useState(target?.description ?? '')

  return (
    <form
      id={props.formId}
      className="flex flex-col gap-7"
      onSubmit={async (event) => {
        event.preventDefault()
        const ok = await props.apply(
          target
            ? { kind: 'updateTarget', id: target.id, changes: { title, description } }
            : { kind: 'createTarget', input: { title, description } },
        )
        if (ok) props.onClose()
      }}
    >
      <InputGroup label="Title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
    </form>
  )
}

interface EpicDraft {
  title: string
  description: string
  targetId: number | null
  color: EpicColor
}

function EpicForm(props: FormProps & { id: number | null }) {
  const epic = props.board.epics.find((e) => e.id === props.id)
  const [fields, edit] = useReducer(patchDraft<EpicDraft>, {
    title: epic?.title ?? '',
    description: epic?.description ?? '',
    targetId: epic?.targetId ?? null,
    color: epic?.color ?? defaultEpicColor(props.board.epics.length),
  })

  return (
    <form
      id={props.formId}
      className="flex flex-col gap-7"
      onSubmit={async (event) => {
        event.preventDefault()
        const ok = await props.apply(
          epic ? { kind: 'updateEpic', id: epic.id, changes: fields } : { kind: 'createEpic', input: fields },
        )
        if (ok) props.onClose()
      }}
    >
      <InputGroup label="Title" autoFocus value={fields.title} onChange={(e) => edit({ title: e.target.value })} />
      <Select
        label="Target"
        value={fields.targetId ?? ''}
        onChange={(e) => edit({ targetId: e.target.value ? Number(e.target.value) : null })}
        options={[
          { value: '', label: 'No target' },
          ...props.board.targets.map((t) => ({ value: String(t.id), label: t.title })),
        ]}
      />
      <EpicColorField value={fields.color} onChange={(color) => edit({ color })} />
      <Textarea
        label="Description"
        value={fields.description}
        onChange={(e) => edit({ description: e.target.value })}
      />
    </form>
  )
}

function TicketForm(props: FormProps & { ticket: Ticket }) {
  const { ticket } = props
  const [draft, edit] = useReducer(patchDraft<TicketDraft>, ticket, ticketDraft)
  const { title, description, epicId, column, assigneeId, blocked, blockedReason, priority, labels, baseBranch } = draft
  const repos = draft.picked ?? initialRepoScope(props.repos, ticket)

  async function submit() {
    if (repoScopeError(repos)) {
      edit({ showRepoError: true })
      return
    }
    const saved = await props.apply({ kind: 'updateTicket', id: ticket.id, changes: ticketChanges(draft, repos) })
    if (saved && column !== ticket.column) {
      await props.apply({ kind: 'moveTicket', id: ticket.id, column })
    }
  }

  // An assignee id that is not a current Employee (e.g. fired) stays selectable.
  const assignees = props.employees.map((e) => ({ value: e.id, label: `${e.name} · ${e.title}` }))
  if (assigneeId && !assignees.some((a) => a.value === assigneeId)) {
    assignees.push({ value: assigneeId, label: assigneeId })
  }

  return (
    <form
      id={props.formId}
      className="flex flex-col gap-7"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <InputGroup label="Title" value={title} onChange={(e) => edit({ title: e.target.value })} />
      <Textarea label="Description" value={description} onChange={(e) => edit({ description: e.target.value })} />
      <RepoChips
        className="mb-5"
        repos={props.repos}
        selected={repos}
        onChange={(picked) => edit({ picked })}
        hint="One worktree and one PR per repo."
        error={draft.showRepoError ? repoScopeError(repos) : null}
      />
      <BaseBranchField value={baseBranch} onChange={(baseBranch) => edit({ baseBranch })} />
      <div className="flex gap-12 [&>*]:min-w-0 [&>*]:flex-[1_1_0]">
        <Select
          label="Assignee"
          value={assigneeId}
          onChange={(e) => edit({ assigneeId: e.target.value })}
          options={[{ value: '', label: 'Unclaimed' }, ...assignees]}
        />
        <PriorityField value={priority} onChange={(priority) => edit({ priority })} />
      </div>
      <LabelsField value={labels} onChange={(labels) => edit({ labels })} />
      {/* The frame has neither Epic nor Column — it says the column in the header line instead —
          but dropping them would leave an existing ticket's epic with nowhere to be changed, so
          they stay as one row here, under the fields the frame does draw. */}
      <div className="flex gap-12 [&>*]:min-w-0 [&>*]:flex-[1_1_0]">
        <Select
          label="Epic"
          value={epicId ?? ''}
          onChange={(e) => edit({ epicId: e.target.value ? Number(e.target.value) : null })}
          options={[
            { value: '', label: 'No epic' },
            ...props.board.epics.map((epic) => ({ value: String(epic.id), label: epic.title })),
          ]}
        />
        <Select
          label="Column"
          value={column}
          onChange={(e) => edit({ column: e.target.value as Column })}
          options={COLUMNS.map((c) => ({ value: c, label: COLUMN_TITLES[c] }))}
        />
      </div>
      <BlockedBy ticket={ticket} tickets={props.board.tickets} facts={props.facts} apply={props.apply} />
      {/* The manual flag, for what is outside the board; a ticket can be both (T266). */}
      <div className="flex items-center gap-12 px-0 py-3">
        <span className="flex-[1_1_0] font-semibold text-13/[normal] text-foreground">Blocked by something else</span>
        <Toggle
          label=""
          aria-label="Blocked by something else"
          data-ui="BlockedToggle"
          className={'[&_[data-slot=choice-label]:empty]:hidden'}
          checked={blocked}
          onChange={(e) => edit({ blocked: e.target.checked })}
        />
      </div>
      {blocked && (
        <InputGroup label="Why" value={blockedReason} onChange={(e) => edit({ blockedReason: e.target.value })} />
      )}
    </form>
  )
}

function TicketEditor(props: FormProps & { ticket: Ticket }) {
  const { ticket } = props
  return (
    <>
      <TicketForm {...props} ticket={ticket} />
      <div className="h-1 w-full shrink-0 bg-border" />
      <TicketPlan
        ticket={ticket}
        facts={props.facts}
        repoName={props.repoName}
        employeeName={(id) => props.employees.find((e) => e.id === id)?.name ?? id}
      />
      <Subtasks {...props} ticket={ticket} />
      <CodeAndReview {...props} ticket={ticket} />
      <TicketRestorePoints ticketId={ticket.id} repoName={props.repoName} />
    </>
  )
}

/** SUBTASKS: the label with `n of m` beside it, checkbox rows, and `+ Add subtask` as a text link. */
function Subtasks(props: FormProps & { ticket: Ticket }) {
  const { ticket, apply } = props
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const done = ticket.subtasks.filter((s) => s.done).length
  const repoOptions = [
    { value: '', label: 'any repo' },
    ...ticket.repos.map((r) => ({ value: r, label: props.repoName(r) })),
  ]

  async function add() {
    if (!draft.trim()) return setAdding(false)
    const ok = await apply({ kind: 'createSubtask', input: { ticketId: ticket.id, title: draft, repo: null } })
    if (ok) setDraft('')
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex items-center gap-8">
        <h4 className={SECTION_LABEL}>Subtasks</h4>
        <span className="text-11-5/[normal] text-muted-foreground">
          {done} of {ticket.subtasks.length}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-8 p-0 empty:hidden">
        {ticket.subtasks.map((subtask) => (
          <li key={subtask.id} data-ui="Subtask" className={SUBTASK_ROW}>
            <Checkbox
              label=""
              aria-label="Done"
              checked={subtask.done}
              onChange={(e) =>
                void apply({ kind: 'updateSubtask', id: subtask.id, changes: { done: e.target.checked } })
              }
            />
            <input
              className={cx(SUBTASK_TITLE, subtask.done ? 'text-muted-foreground' : 'text-foreground')}
              defaultValue={subtask.title}
              aria-label="Subtask title"
              onBlur={(e) => {
                if (e.target.value !== subtask.title) {
                  void apply({ kind: 'updateSubtask', id: subtask.id, changes: { title: e.target.value } })
                }
              }}
            />
            {/* The frame draws the row as checkbox and title alone; the repo and the remove stay,
                come out on hover or focus, and take no height, so the row is the frame's 18px. */}
            <span data-ui="SubtaskTools" className={SUBTASK_TOOLS}>
              {ticket.repos.length > 0 && (
                <select
                  className="max-w-120 rounded-[6px] border border-input bg-card px-6 py-3 font-sans text-11-5/[inherit] text-foreground"
                  aria-label="Repo"
                  value={subtask.repo ?? ''}
                  onChange={(e) =>
                    void apply({ kind: 'updateSubtask', id: subtask.id, changes: { repo: e.target.value || null } })
                  }
                >
                  {repoOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <IconButton
                icon={X}
                size="sm"
                label="Remove subtask"
                onClick={() => void apply({ kind: 'deleteSubtask', id: subtask.id })}
              />
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <input
          className={cx(SUBTASK_TITLE, 'text-foreground placeholder:text-muted-foreground placeholder:opacity-100')}
          ref={focusOnMount}
          aria-label="New subtask"
          placeholder="What is left to do?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setDraft('')
              setAdding(false)
            }
          }}
          onBlur={() => {
            void add()
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="m-0 cursor-pointer self-start border-0 bg-transparent p-0 font-sans font-semibold text-12-5/[normal] text-primary hover:text-primary-hover focus-visible:shadow-focus focus-visible:outline-none"
          onClick={() => setAdding(true)}
        >
          + Add subtask
        </button>
      )}
    </section>
  )
}

/** CODE & REVIEW: one card with the branch, the PR, a divider and the way into the Review screen. */
function CodeAndReview(props: FormProps & { ticket: Ticket }) {
  const { ticket, facts } = props
  const code = codeOf(ticket.id, facts)
  const review = latestReview(ticket.id, facts)
  const reviewable = canOpenReview(ticket, code)
  const hasCode = (code?.worktrees.length ?? 0) > 0 || (code?.pullRequests.length ?? 0) > 0
  if (!hasCode && !reviewable && !review) return null
  return (
    <section className="flex flex-col gap-6">
      <h4 className={SECTION_LABEL}>Code &amp; review</h4>
      <div data-ui="CodeCard" className="flex flex-col gap-7 rounded-sm border border-border bg-card p-10">
        <TicketCode code={code} repos={ticket.repos} repoName={props.repoName} />
        <TicketReview
          ticketId={ticket.id}
          review={review}
          canOpen={reviewable}
          decidable={ticket.column === 'review'}
          employees={props.employees}
          repoName={props.repoName}
        />
      </div>
    </section>
  )
}
