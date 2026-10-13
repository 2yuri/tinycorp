import { ArrowRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { type BoardCommand, COLUMN_TITLES, type Ticket } from '../../../shared/domain/board'
import { blockerCandidates } from '../../../shared/ticket-links'
import { hashSuggestions } from '../../../shared/ticket-refs'
import { cx, focusOnMount } from '../ui'
import { type BoardFacts, ticketLabel } from './board-model'

/** The drawer's section labels, which this one shares. */
const LABEL =
  'm-0 font-sans text-11/[normal] font-bold tracking-[0.5px] whitespace-nowrap text-muted-foreground uppercase'
/** One blocker (frame `sLKP8`): 8×10 inside a 1px stroke, so 7×9 of padding. */
const ROW = 'flex items-center gap-8 rounded-sm border border-border bg-card px-9 py-7'
const TEXT_LINK =
  'm-0 inline-flex cursor-pointer items-center gap-5 self-start border-0 bg-transparent px-2 py-4 font-sans font-semibold text-12/[normal] text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
const OPTION =
  'flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent px-10 py-6 text-left font-sans text-12-5/[normal] text-soft-ink-adaptive hover:bg-secondary data-[active=true]:bg-secondary'

export interface BlockedByProps {
  ticket: Ticket
  /** The whole board's tickets: the blockers are named and searched from them. */
  tickets: readonly Ticket[]
  facts: Pick<BoardFacts, 'companyKey'>
  apply(command: BoardCommand): Promise<boolean>
}

/**
 * BLOCKED BY (T266, frame `sLKP8`): the tickets this one waits on, each with its column and a
 * remove, `+ Add a blocker`, and the tickets that wait on it. A link is saved the moment it is
 * made, like a subtask, rather than with the form: it is not a field of the ticket.
 */
export function BlockedBy(props: BlockedByProps) {
  const { ticket, tickets, facts } = props
  const [adding, setAdding] = useState(false)
  const blockers = ticket.blockedBy.flatMap((id) => tickets.find((t) => t.id === id) ?? [])
  const blocks = ticket.blocks.flatMap((id) => tickets.find((t) => t.id === id) ?? [])
  const done = blockers.filter((t) => t.column === 'done').length
  const code = (id: number) => ticketLabel(id, facts)

  return (
    <section data-ui="BlockedBy" className="flex flex-col gap-6">
      <div className="flex items-center gap-6">
        <h4 className={LABEL}>Blocked by</h4>
        <span className="flex-[1_1_0]" />
        {blockers.length > 0 && (
          <span className="text-11/[normal] text-muted-foreground">
            {done} of {blockers.length} done
          </span>
        )}
      </div>
      {blockers.map((blocker) => {
        const closed = blocker.column === 'done'
        return (
          <div key={blocker.id} data-ui="Blocker" data-done={closed} className={ROW}>
            <span
              className={cx('size-8 shrink-0 rounded-full', closed ? 'bg-brand-success' : 'bg-brand-warning')}
              aria-hidden
            />
            <span className="whitespace-nowrap font-code text-12/[normal] text-foreground">{code(blocker.id)}</span>
            <span
              className={cx(
                'min-w-0 flex-[1_1_0] overflow-hidden text-ellipsis whitespace-nowrap text-12-5/[normal]',
                closed ? 'text-muted-foreground' : 'text-soft-ink-adaptive',
              )}
            >
              {blocker.title}
            </span>
            <span className="whitespace-nowrap text-11/[normal] text-muted-foreground">
              {COLUMN_TITLES[blocker.column]}
            </span>
            <button
              type="button"
              className="m-0 flex cursor-pointer border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
              aria-label={`Remove blocker ${code(blocker.id)}`}
              title="Remove blocker"
              onClick={() => void props.apply({ kind: 'removeBlocker', id: ticket.id, blockedById: blocker.id })}
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        )
      })}
      {adding ? (
        <BlockerPicker
          {...props}
          onPick={async (id) => {
            if (await props.apply({ kind: 'addBlocker', id: ticket.id, blockedById: id })) setAdding(false)
          }}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button type="button" className={TEXT_LINK} onClick={() => setAdding(true)}>
          <Plus size={12} aria-hidden />
          Add a blocker
        </button>
      )}
      {blockers.length > 0 && (
        <p className="m-0 text-11-5/[1.4] text-muted-foreground">
          It starts when every blocker is Done — nobody picks it up before.
        </p>
      )}
      {blocks.length > 0 && (
        <p data-ui="Blocks" className="m-0 flex flex-wrap items-center gap-6 text-11-5/[normal] text-muted-foreground">
          <ArrowRight size={12} aria-hidden />
          Blocks
          {blocks.map((t) => (
            <span key={t.id} className="inline-flex gap-6">
              <span className="font-code text-primary">{code(t.id)}</span>
              <span className="text-soft-ink-adaptive">{t.title}</span>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

/**
 * The search behind `+ Add a blocker`: this Company's tickets by id or title, the composer's own
 * `#` search (`hashSuggestions`), over only the tickets a link may go to — never the ticket itself,
 * one that would close a loop, or one already Done.
 */
function BlockerPicker(props: BlockedByProps & { onPick(id: number): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const candidates = blockerCandidates(props.ticket, props.tickets)
  const found = hashSuggestions(query.trim().replace(/^#/, ''), candidates, [], props.facts.companyKey ?? '')
  const pick = (index: number) => {
    const hit = found[index]
    if (hit) props.onPick(Number(hit.value))
  }

  return (
    <div data-ui="BlockerPicker" className="flex flex-col gap-4">
      <input
        ref={focusOnMount}
        className="m-0 rounded-sm border border-input bg-card px-10 py-7 font-sans text-12-5/[normal] text-foreground outline-none placeholder:text-muted-foreground placeholder:opacity-100 focus-visible:shadow-focus"
        aria-label="Find a ticket to wait on"
        placeholder="Search tickets by id or title"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, found.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            // The drawer's form would take the Enter as a save.
            e.preventDefault()
            pick(active)
          } else if (e.key === 'Escape') {
            // The drawer closes on Escape; here it only closes the search.
            e.stopPropagation()
            props.onClose()
          }
        }}
      />
      <div
        role="listbox"
        aria-label="Tickets"
        className="flex flex-col overflow-hidden rounded-sm border border-border"
      >
        {found.length === 0 && (
          <p className="m-0 px-10 py-6 text-12/[normal] text-muted-foreground">No ticket it could wait on.</p>
        )}
        {found.map((hit, index) => (
          <button
            key={hit.value}
            type="button"
            role="option"
            aria-selected={index === active}
            data-active={index === active}
            className={OPTION}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(index)}
          >
            <span className="font-code text-12/[normal] text-foreground">{hit.insert}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{hit.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
