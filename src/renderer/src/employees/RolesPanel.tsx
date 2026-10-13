import { EllipsisVertical, Plus, Trash2, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { roleIcon } from '../hiring'
import { Button, cx, DropdownMenu, EmptyState, MenuItem, useDismiss } from '../ui'
import { Pill, SidePanel } from './parts'
import { type RoleRow, removeUnusedNote } from './roles-model'
import '../ui/tailwind.css'

/**
 * The Roles list, frame `ffZp1`: every role this Company holds, how many Employees are on it, and
 * the ones nobody was ever hired into (T240).
 *
 * It is on the Employees screen and not in Company settings because a role is only ever read
 * against the people on it: the count on the row, the refusal when one is deleted and the
 * reassignment that answers it are all about the Employee cards beside it.
 */
export function RolesPanel(props: {
  rows: RoleRow[]
  error: string | null
  onNew(): void
  onEdit(roleId: string): void
  onDelete(roleId: string): void
  onRemoveUnused(): void
}) {
  const note = removeUnusedNote(props.rows)
  return (
    <SidePanel
      label="Roles"
      title="Roles"
      sub={subtitle(props.rows)}
      badge={
        <Button size="sm" icon={Plus} onClick={props.onNew}>
          New role
        </Button>
      }
      footer={
        note === null ? undefined : (
          <div className="flex min-w-0 flex-1 basis-0 flex-col gap-9">
            <p className="m-0 font-normal text-11-5/17 text-muted-foreground">{note}</p>
            <Button variant="outline" icon={Trash2} onClick={props.onRemoveUnused}>
              Remove unused roles
            </Button>
          </div>
        )
      }
    >
      {props.error && (
        <p className="m-0 text-12/normal text-status-error-foreground" role="alert">
          {props.error}
        </p>
      )}
      {props.rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No roles yet"
          body="A role arrives with the first Employee hired into it, or you can write one now."
          action={<Button onClick={props.onNew}>New role</Button>}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-10 p-0">
          {props.rows.map((row) => (
            <RoleListRow
              key={row.role.id}
              row={row}
              onEdit={() => props.onEdit(row.role.id)}
              onDelete={() => props.onDelete(row.role.id)}
            />
          ))}
        </ul>
      )}
    </SidePanel>
  )
}

function RoleListRow({ row, onEdit, onDelete }: { row: RoleRow; onEdit(): void; onDelete(): void }) {
  const [open, setOpen] = useState(false)
  const dismiss = useDismiss<HTMLDivElement, HTMLButtonElement>(open, () => setOpen(false))
  const Icon = roleIcon(row.role.name)
  return (
    <li className={cx(ROW, row.unused && 'bg-muted')}>
      <Icon size={15} className={row.unused ? 'text-muted-foreground' : 'text-foreground'} aria-hidden />
      <button type="button" className={ROW_OPEN} onClick={onEdit}>
        <span className={cx(ROW_NAME, row.unused ? 'text-muted-foreground' : 'text-foreground')}>{row.role.name}</span>
        <span className={ROW_META}>{row.meta}</span>
      </button>
      {row.unused ? <Pill tone="warning">Not used</Pill> : <Pill tone="muted">{row.count}</Pill>}
      <span className="relative h-24">
        <button
          type="button"
          ref={dismiss.trigger}
          className={MORE}
          aria-label={`More for ${row.role.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
        >
          <EllipsisVertical size={15} aria-hidden />
        </button>
        {open && (
          <DropdownMenu ref={dismiss.popover} className="absolute top-28 right-0 z-10 min-w-170">
            <MenuItem label="Edit role" onClick={() => (setOpen(false), onEdit())} />
            <MenuItem label="Delete role…" destructive onClick={() => (setOpen(false), onDelete())} />
          </DropdownMenu>
        )}
      </span>
    </li>
  )
}

/** `Eight in this Company · one not used`, as the frame words it. */
function subtitle(rows: RoleRow[]): string {
  if (rows.length === 0) return 'None yet'
  const unused = rows.filter((row) => row.unused).length
  const held = `${rows.length} in this Company`
  return unused === 0 ? held : `${held} · ${unused} not used`
}

const ROW = 'flex items-center gap-11 rounded-md border border-border bg-secondary px-12 py-10'

const ROW_OPEN =
  'flex min-w-0 flex-1 basis-0 cursor-pointer flex-col items-start gap-2 border-0 bg-transparent p-0 text-left [font:inherit]'

const ROW_NAME = 'font-bold text-13-5/normal'

const ROW_META = 'max-w-full truncate font-code font-normal text-10-5/normal text-muted-foreground'

const MORE =
  'flex h-24 w-24 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-muted-foreground'
