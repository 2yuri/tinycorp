import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { openTicket } from '../board'
import { navigate } from '../chrome'
import { cx, initialsOf, SHELL_BUTTON } from '../ui'
import type { ShellData } from './nav-model'
import { noResults, type SearchHit, searchShell } from './search-model'
import '../ui/tailwind.css'

/**
 * The drawer's search (design/html/company-settings.html: Company Drawer › Search). It lists the
 * Employees and tickets that match; picking an Employee opens their DM, a ticket opens it on the Board.
 */
export function SidebarSearch({ data, companyKey }: { data: ShellData; companyKey: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  const hits = searchShell(query, data, companyKey)
  const showing = open && query.trim().length > 0

  useEffect(() => {
    if (!showing) return
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [showing])

  function pick(hit: SearchHit) {
    setQuery('')
    setOpen(false)
    if (hit.kind === 'ticket') return openTicket(hit.id)
    // A DM is where the boss talks to one Employee, as the Employee drawer's own DM button does.
    navigate({ view: 'chat', channelId: dmChannelId(BOSS, hit.id) })
  }

  // The results drop under the field, over the navigation.
  return (
    <div className="relative w-full" ref={box}>
      <label className={FIELD}>
        <Search size={15} aria-hidden />
        <input
          value={query}
          placeholder="Search Employees or tickets"
          aria-label="Search"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return setOpen(false)
            if (event.key === 'Enter' && hits[0]) {
              event.preventDefault()
              pick(hits[0])
            }
          }}
        />
      </label>
      {showing && (
        <div className={RESULTS} id={listId} role="listbox">
          {hits.length === 0 ? (
            <p className="m-0 px-8 py-6 text-12/17 text-muted-foreground">{noResults(query)}</p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.key}
                type="button"
                role="option"
                aria-selected={false}
                className={cx(SHELL_BUTTON, HIT)}
                onClick={() => pick(hit)}
              >
                <span className={MARK} aria-hidden>
                  {hit.kind === 'employee' ? initialsOf(hit.label) : '#'}
                </span>
                <span className="flex-1 basis-0 truncate">{hit.label}</span>
                <span className="shrink-0 text-11/normal text-muted-foreground">{hit.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* The drawer's search (design/html/company-settings.html: Company Drawer › Search). */
const FIELD =
  'flex w-full shrink-0 items-center gap-8 rounded-sm border border-border px-11 py-7 text-muted-foreground [&>svg]:shrink-0 [&_input]:m-0 [&_input]:h-16 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:p-0 [&_input]:font-normal [&_input]:text-13/normal [&_input]:text-foreground [&_input]:outline-none [&_input::placeholder]:text-muted-foreground [&_input::placeholder]:opacity-100'

const RESULTS =
  'absolute top-[calc(100%+6px)] right-0 left-0 z-3 flex flex-col gap-2 rounded-sm border border-border bg-popover p-6 shadow-menu'

const HIT = 'flex items-center gap-8 rounded-sm px-8 py-6 text-left text-13/normal text-foreground hover:bg-secondary'

const MARK =
  'flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-10/normal text-muted-foreground'
