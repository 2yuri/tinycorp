import { Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DELETE_TICKET_ACTION,
  deleteTicketBody,
  deleteTicketTitle,
  type TicketRemoval,
} from '../../../shared/ticket-removal'
import { Alert, Button } from '../ui'

// Read when it is used, not when the module loads: the board is rendered in tests with no window.
const api = () => window.tinyCorp.board

export interface TicketDelete {
  /** Asks the engine what deleting the ticket takes with it, and asks the boss to confirm. */
  ask(ticketId: number): void
  /** Why the ticket stays, when the engine said so; the drawer shows it over the form. */
  refusal: string | null
  dismissRefusal(): void
  /** The confirmation, rendered into `document.body`; null while nothing is being deleted. */
  overlay: ReactNode
}

/**
 * Delete ticket, from the ticket's drawer (T275, frames `eKZNK` and `xdaOR`). The engine refuses a
 * ticket that holds work and says why; otherwise the confirmation names what goes with it, and
 * `onDeleted` runs once it went. The engine announces the change, so the board follows on its own.
 */
export function useTicketDelete(onDeleted: () => void): TicketDelete {
  const [removal, setRemoval] = useState<TicketRemoval | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = useCallback((ticketId: number) => {
    setRefusal(null)
    setError(null)
    void api()
      .ticketRemoval(ticketId)
      .then((result) => (result.ok ? setRemoval(result.value) : setRefusal(result.error)))
  }, [])

  const cancel = useCallback(() => {
    setRemoval(null)
    setError(null)
  }, [])

  const confirm = useCallback(
    async (ticketId: number) => {
      setBusy(true)
      try {
        const result = await api().deleteTicket(ticketId)
        if (result.ok) {
          setRemoval(null)
          onDeleted()
        } else setError(result.error)
      } finally {
        setBusy(false)
      }
    },
    [onDeleted],
  )

  const overlay =
    removal &&
    createPortal(
      <DeleteTicketDialog
        removal={removal}
        busy={busy}
        error={error}
        onCancel={cancel}
        onConfirm={() => void confirm(removal.ticketId)}
      />,
      document.body,
    )

  return { ask, refusal, dismissRefusal: () => setRefusal(null), overlay }
}

/** The confirmation: the ticket and what goes with it, because this cannot be undone. */
export function DeleteTicketDialog(props: {
  removal: TicketRemoval
  busy: boolean
  error: string | null
  onCancel(): void
  onConfirm(): void
}) {
  const { onCancel, busy } = props
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Cancel takes the focus, so a stray Enter never deletes.
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel, busy])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#0b1220cc] p-24 font-sans leading-[normal]"
      onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}
    >
      <div
        ref={dialog}
        className="flex w-440 max-w-full flex-col rounded-md border border-border bg-card shadow-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-ticket-title"
        aria-describedby="delete-ticket-body"
      >
        <div className="flex gap-14 px-20 pt-20 pb-16">
          <span
            className="flex size-36 shrink-0 items-center justify-center rounded-sm bg-status-error text-status-error-foreground"
            aria-hidden
          >
            <Trash2 size={18} />
          </span>
          <div className="flex min-w-0 shrink grow basis-0 flex-col gap-6">
            <h2 className="m-0 font-bold text-16 text-foreground [overflow-wrap:anywhere]" id="delete-ticket-title">
              {deleteTicketTitle(props.removal)}
            </h2>
            <p className="m-0 text-12-5/18 text-muted-foreground [overflow-wrap:anywhere]" id="delete-ticket-body">
              {deleteTicketBody(props.removal)}
            </p>
          </div>
        </div>
        {props.error && <Alert variant="error" title={props.error} className="mt-0 mr-20 mb-14 ml-20" />}
        <div className="flex justify-end gap-10 border-border border-t px-20 pt-13 pb-14">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="toolbar" icon={Trash2} disabled={busy} onClick={props.onConfirm}>
            {DELETE_TICKET_ACTION}
          </Button>
        </div>
      </div>
    </div>
  )
}
