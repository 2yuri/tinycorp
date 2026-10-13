/**
 * The board's own chrome (T214): the drop line between two cards, the popover every menu on the
 * screen hangs from, the title's scope picker and the column's WIP label.
 *
 * They came out of `Board.tsx` whole — same markup, same class lists — so the board is left with
 * the columns and what it does to them.
 */
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardSnapshot } from '../../../shared/domain/board'
import { cx, DropdownMenu, focusOnMount, MenuDivider, MenuItem } from '../ui'
import type { BoardScope } from './board-model'
import '../ui/tailwind.css'

/** The column's WIP limit: out of the way until the head is hovered, red once it is over. */
const WIP =
  'm-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-10-5/[normal] font-bold tracking-[0.4px] whitespace-nowrap text-muted-foreground'
const WIP_UNSET = 'opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100'
/** The board picker in the shell's header. */
const PICKER =
  'm-0 flex min-w-0 cursor-pointer items-center gap-8 border-0 bg-transparent p-0 text-muted-foreground [&_svg]:shrink-0 focus-visible:rounded-[4px] focus-visible:shadow-focus focus-visible:outline-none'

/** A card and, above it, the line a dragged card would land on. */
export function Slot(props: { show: boolean; children: ReactNode }) {
  return (
    <>
      {props.show && <li className="mx-0 my-[-6px] h-2 shrink-0 rounded-[1px] bg-primary" />}
      {props.children}
    </>
  )
}

/** A trigger with a dropdown menu under it, drawn over everything; closes on a click outside or Escape. */
export function Popover(props: {
  align?: 'start' | 'end'
  trigger(toggle: () => void, open: boolean): ReactNode
  children(close: () => void): ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current) return setPlace(null)
    const box = anchor.current.getBoundingClientRect()
    setPlace(
      props.align === 'end'
        ? { top: box.bottom + 6, right: window.innerWidth - box.right }
        : { top: box.bottom + 6, left: box.left },
    )
  }, [open, props.align])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!anchor.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <span className="flex min-w-0" ref={anchor}>
      {props.trigger(() => setOpen((o) => !o), open)}
      {open &&
        place &&
        createPortal(
          <div ref={menu} className="fixed z-40 max-h-[60vh] min-w-200 overflow-y-auto font-sans" style={place}>
            <DropdownMenu>{props.children(() => setOpen(false))}</DropdownMenu>
          </div>,
          document.body,
        )}
    </span>
  )
}

/** The title with its chevron: picks every ticket, a Target or one of its Epics. */
export function ScopePicker(props: {
  title: string
  board: BoardSnapshot
  /** The scope shown, or null while a sidebar View filters the board. */
  current: BoardScope | null
  onPick(scope: BoardScope): void
}) {
  const { board, current } = props
  const loose = board.epics.filter((e) => e.targetId === null)
  const pick = (scope: BoardScope, close: () => void) => () => {
    props.onPick(scope)
    close()
  }
  const is = (kind: BoardScope['kind'], id?: number) =>
    current?.kind === kind && (id === undefined || ('id' in current && current.id === id))

  return (
    <Popover
      trigger={(toggle, open) => (
        <button type="button" className={PICKER} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-[inherit] text-foreground tracking-[inherit]">
            {props.title}
          </span>
          <ChevronDown size={15} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem label="All tickets" highlighted={is('all')} onClick={pick({ kind: 'all' }, close)} />
          {board.targets.map((target) => (
            <div key={target.id} className="contents">
              <MenuDivider />
              <MenuItem
                label={target.title}
                className="font-semibold"
                highlighted={is('target', target.id)}
                onClick={pick({ kind: 'target', id: target.id }, close)}
              />
              {board.epics
                .filter((e) => e.targetId === target.id)
                .map((epic) => (
                  <MenuItem
                    key={epic.id}
                    label={epic.title}
                    className="pl-26"
                    highlighted={is('epic', epic.id)}
                    onClick={pick({ kind: 'epic', id: epic.id }, close)}
                  />
                ))}
            </div>
          ))}
          {loose.length > 0 && <MenuDivider />}
          {loose.map((epic) => (
            <MenuItem
              key={epic.id}
              label={epic.title}
              className="pl-26"
              highlighted={is('epic', epic.id)}
              onClick={pick({ kind: 'epic', id: epic.id }, close)}
            />
          ))}
        </>
      )}
    </Popover>
  )
}

/** `WIP n / m` in the column head; click to change the limit. Columns without one show it on hover. */
export function WipLabel(props: {
  count: number
  limit: number | null
  over: boolean
  onChange(limit: number | null): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <form
        className="[&_input]:w-56 [&_input]:rounded-[4px] [&_input]:border [&_input]:border-input [&_input]:bg-card [&_input]:px-4 [&_input]:py-1 [&_input]:text-11/[inherit]"
        onSubmit={(event) => {
          event.preventDefault()
          const value = draft.trim()
          props.onChange(value === '' ? null : Number(value))
          setEditing(false)
        }}
      >
        <input
          ref={focusOnMount}
          type="number"
          min={1}
          step={1}
          placeholder="none"
          aria-label="WIP limit"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => event.currentTarget.form?.requestSubmit()}
          onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      className={cx(WIP, props.limit === null && WIP_UNSET, props.over && 'text-status-error-foreground')}
      title={props.over ? `Over WIP limit by ${props.count - props.limit!}` : 'Set the WIP limit'}
      onClick={() => {
        setDraft(props.limit === null ? '' : String(props.limit))
        setEditing(true)
      }}
    >
      {props.limit === null ? 'Set WIP' : `WIP ${props.count} / ${props.limit}`}
    </button>
  )
}
