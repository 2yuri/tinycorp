import { Ellipsis, ListFilter, Plus, Users } from 'lucide-react'
import { type DragEvent, useEffect, useState } from 'react'
import type { Company } from '../../../shared/company'
import type { BoardCommand, Column } from '../../../shared/domain/board'
import type { Route } from '../chrome'
import { ViewHeader } from '../chrome'
import { publishIpcValue, resources, useIpcResource } from '../ipc'
import { Button, cx, IconButton, MenuDivider, MenuItem } from '../ui'
import { Popover, ScopePicker, Slot, WipLabel } from './BoardChrome'
import {
  boardMeta,
  needYou,
  planningEpics,
  resolveScope,
  routeOf,
  scopeTitle,
  selectionOf,
  ticketLabel,
  visibleTickets,
} from './board-model'
import { type Editing, Editor } from './Editor'
import { NewTicketModal } from './NewTicketModal'
import { onOpenTicket } from './open-ticket'
import { type CardView, EpicCard, TicketCard } from './TicketCard'
import { useBoardData } from './use-board-data'
import { dropIndex, useCardDrag } from './use-card-drag'
import '../ui/tailwind.css'

const api = window.tinyCorp.board

type BoardRoute = Extract<Route, { view: 'board' }>

/**
 * The current Company's kanban board: the scope picker and actions in the content header,
 * four columns and the editor panel. The route (sidebar or picker) says which tickets it shows.
 */
/** The board's own toolbar button, which is the kit's with the frame's padding. */
const TOOL = 'px-12 py-8 aria-disabled:cursor-default'

export function Board(props: { company: Company; route: BoardRoute; onNavigate(route: Route): void }) {
  const { board, facts, employees, autonomy } = useBoardData(props.company.key)
  // An Employee id, null for unclaimed tickets; undefined shows everyone's.
  const [assignee, setAssignee] = useState<string | null | undefined>(undefined)
  const selection = { ...selectionOf(props.route), ...(assignee !== undefined && { assignee }) }
  const [view, setView] = useState<CardView>('full')
  const [editing, setEditing] = useState<Editing | null>(null)
  // New ticket is the frame's own modal (design `Y5daiS`), not the drawer: it holds the column the
  // action was taken in, and the epic the board is scoped to.
  const [creating, setCreating] = useState<{ column: Column; epicId: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cards = useCardDrag()
  const repos = useIpcResource(resources.repos)

  useEffect(
    () =>
      onOpenTicket((id) => {
        setView('full')
        setEditing({ kind: 'ticket', id })
      }),
    [],
  )

  async function apply(command: BoardCommand): Promise<boolean> {
    const result = await api.apply(command)
    setError(result.ok ? null : result.error)
    // The engine broadcasts the same board; putting it in now saves the card the round trip.
    if (result.ok) publishIpcValue(resources.board, result.value)
    return result.ok
  }

  if (!board) return null
  // Narrowed above, and named so the handlers below never reach for `board!`.
  const shownBoard = board

  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? 'removed repo'
  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? id
  const employeePerson = (id: string) => {
    const found = employees.find((e) => e.id === id)
    return found ? { id: found.id, sprite: found.sprite } : null
  }
  const tickets = visibleTickets(board, facts, selection)
  const epicOf = new Map(board.epics.map((epic) => [epic.id, epic]))
  const heading = scopeTitle(board, selection)
  const scope = resolveScope(board, selection.scope)
  const scopedEpic = selection.view === null && scope.kind === 'epic' ? scope.id : null

  /** The engine orders the whole column; the card goes next to the neighbour the boss can see. */
  function drop(event: DragEvent<HTMLElement>, column: Column) {
    cards.drop(event, (id, at) => {
      const inColumn = shownBoard.tickets.filter((t) => t.column === column)
      const index = dropIndex(
        inColumn,
        tickets.filter((t) => t.column === column),
        at,
        id,
      )
      void apply({ kind: 'moveTicket', id, column, index })
    })
  }

  function newTicket(column: Column) {
    setError(null)
    setCreating({ column, epicId: scopedEpic })
  }

  return (
    <div className="flex min-h-0 w-full flex-[1_1_0] flex-col bg-background font-sans leading-[normal]">
      <ViewHeader
        title={
          <ScopePicker
            title={heading.title}
            board={board}
            current={selection.view === null ? scope : null}
            onPick={(next) => props.onNavigate(routeOf(next))}
          />
        }
        badge={
          heading.badge && (
            <span className="inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-9 py-3 font-semibold text-11/[inherit] text-soft-ink-adaptive">
              <span className="size-6 rounded-full bg-brand-text-muted" aria-hidden />
              {heading.badge}
            </span>
          )
        }
        subtitle={boardMeta(board, tickets)}
      >
        <div className="flex items-center gap-12">
          <Popover
            trigger={(toggle, open) => (
              <Button
                variant="ghost"
                size="toolbar"
                icon={ListFilter}
                className={cx(TOOL, selection.assignee !== undefined && 'text-foreground')}
                aria-expanded={open}
                onClick={toggle}
              >
                Filter
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  label="Anyone"
                  highlighted={selection.assignee === undefined}
                  onClick={() => {
                    setAssignee(undefined)
                    close()
                  }}
                />
                <MenuItem
                  label="Unclaimed"
                  highlighted={selection.assignee === null}
                  onClick={() => {
                    setAssignee(null)
                    close()
                  }}
                />
                {employees.length > 0 && <MenuDivider />}
                {employees.map((employee) => (
                  <MenuItem
                    key={employee.id}
                    label={employee.name}
                    highlighted={selection.assignee === employee.id}
                    onClick={() => {
                      setAssignee(employee.id)
                      close()
                    }}
                  />
                ))}
              </>
            )}
          </Popover>
          <Button
            variant="ghost"
            size="toolbar"
            icon={Users}
            className={TOOL}
            aria-disabled="true"
            title="Grouping by Employee is not available yet"
          >
            Group: Employee
          </Button>
          <Button icon={Plus} onClick={() => newTicket('planning')}>
            New ticket
          </Button>
          <Popover
            align="end"
            trigger={(toggle, open) => (
              <IconButton icon={Ellipsis} label="More" className="size-36" aria-expanded={open} onClick={toggle} />
            )}
          >
            {(close) => {
              const run = (action: () => void) => () => {
                action()
                close()
              }
              return (
                <>
                  <MenuItem label="Full cards" highlighted={view === 'full'} onClick={run(() => setView('full'))} />
                  <MenuItem label="Minified cards" highlighted={view === 'mini'} onClick={run(() => setView('mini'))} />
                  <MenuDivider />
                  <MenuItem label="New target" onClick={run(() => setEditing({ kind: 'target', id: null }))} />
                  <MenuItem label="New epic" onClick={run(() => setEditing({ kind: 'epic', id: null }))} />
                  {selection.view === null && scope.kind === 'target' && (
                    <MenuItem label="Edit target" onClick={run(() => setEditing({ kind: 'target', id: scope.id }))} />
                  )}
                  {scopedEpic !== null && (
                    <MenuItem label="Edit epic" onClick={run(() => setEditing({ kind: 'epic', id: scopedEpic }))} />
                  )}
                </>
              )
            }}
          </Popover>
        </div>
      </ViewHeader>

      {error && !editing && !creating && (
        <p className="mx-24 mt-12 mb-0 text-13/[inherit] text-status-error-foreground" role="alert">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-[1_1_0] gap-16 p-24">
        {board.columns.map((column) => {
          const inColumn = tickets.filter((t) => t.column === column.id)
          // Epics are planned too, and their cards sit in Planning beside the tickets (T171).
          const epics = column.id === 'planning' ? planningEpics(shownBoard, facts, selection) : []
          const waiting = column.id === 'planning' ? needYou(inColumn, facts) : 0
          return (
            <section
              key={column.id}
              className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col gap-10"
              aria-label={column.title}
              onDragOver={(event) => cards.over(event, column.id)}
              onDrop={(event) => drop(event, column.id)}
            >
              <header className="group/head flex items-center gap-8 px-4 pt-0 pb-2">
                <h3
                  className={cx(
                    'm-0 whitespace-nowrap font-bold text-13/[inherit] tracking-[0.2px]',
                    column.overLimit ? 'text-status-error-foreground' : 'text-foreground',
                  )}
                >
                  {column.title}
                </h3>
                <span className="font-semibold text-12/[inherit] text-muted-foreground">
                  {inColumn.length + epics.length}
                </span>
                <span className="flex-[1_1_0]" />
                {waiting > 0 && (
                  <span className="whitespace-nowrap font-semibold text-11/[inherit] text-brand-warning">
                    {waiting} need you
                  </span>
                )}
                <WipLabel
                  count={column.count}
                  limit={column.wipLimit}
                  over={column.overLimit}
                  onChange={(limit) => apply({ kind: 'setWipLimit', column: column.id, limit })}
                />
                <button
                  type="button"
                  className="m-0 flex cursor-pointer border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                  aria-label={`New ticket in ${column.title}`}
                  title={`New ticket in ${column.title}`}
                  onClick={() => newTicket(column.id)}
                >
                  <Plus size={15} aria-hidden />
                </button>
              </header>
              <ul className="m-0 flex min-h-0 flex-[1_1_0] list-none flex-col gap-10 overflow-y-auto px-0 pt-2 pb-0">
                {inColumn.map((ticket, index) => (
                  <Slot key={ticket.id} show={cards.hint?.column === column.id && cards.hint.index === index}>
                    <TicketCard
                      ticket={ticket}
                      facts={facts}
                      tickets={shownBoard.tickets}
                      epic={ticket.epicId === null ? null : epicOf.get(ticket.epicId)}
                      view={view}
                      repoName={repoName}
                      employeeName={employeeName}
                      employeePerson={employeePerson}
                      dragging={cards.dragged === ticket.id}
                      onOpen={() => setEditing({ kind: 'ticket', id: ticket.id })}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', ticketLabel(ticket.id, facts))
                        cards.start(ticket.id)
                      }}
                      onDragEnd={cards.end}
                    />
                  </Slot>
                ))}
                {cards.hint?.column === column.id && cards.hint.index === inColumn.length && (
                  <li className="mx-0 my-[-6px] h-2 shrink-0 rounded-[1px] bg-primary" />
                )}
                {epics.map((epic) => (
                  <EpicCard
                    key={`epic-${epic.id}`}
                    epic={epic}
                    facts={facts}
                    tickets={shownBoard.tickets.filter((t) => t.epicId === epic.id).length}
                    employeeName={employeeName}
                    employeePerson={employeePerson}
                    onOpen={() => setEditing({ kind: 'epic', id: epic.id })}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {creating && (
        <NewTicketModal
          board={board}
          column={creating.column}
          epicId={creating.epicId}
          repos={repos}
          employees={employees}
          companyName={props.company.name}
          autonomy={autonomy}
          apply={apply}
          error={error}
          onClose={() => {
            setCreating(null)
            setError(null)
          }}
        />
      )}

      {editing && (
        <Editor
          board={board}
          editing={editing}
          apply={apply}
          repos={repos}
          repoName={repoName}
          employees={employees}
          facts={facts}
          companyName={props.company.name}
          error={error}
          onClose={() => {
            setEditing(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
