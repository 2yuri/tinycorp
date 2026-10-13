import { Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type ChannelRemoval, deleteChannelBody, deleteChannelTitle } from '../../../shared/channel-removal'
import { Alert, Button } from '../ui'

// Read when it is used, not when the module loads: the shell's sidebar imports this too, and it is
// rendered statically in tests that have no window.
const api = () => window.tinyCorp.chat

export interface ChannelDelete {
  /** Asks first, naming the channel and what goes with it. */
  ask(channelId: string): void
  /** The confirmation, rendered into `document.body`; null while nothing is being deleted. */
  overlay: ReactNode
}

/**
 * Delete channel… wherever it is offered (T112): the sidebar's channel rows and the channel's own
 * header each hold one of these. The engine announces the delete, so every view follows on its own.
 */
export function useChannelDelete(): ChannelDelete {
  const [removal, setRemoval] = useState<ChannelRemoval | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = useCallback((channelId: string) => {
    setError(null)
    setRemoval(null)
    void api()
      .channelRemoval(channelId)
      .then((result) => {
        if (result.ok) setRemoval(result.value)
        else setError(result.error)
      })
  }, [])

  const cancel = useCallback(() => {
    setRemoval(null)
    setError(null)
  }, [])

  const confirm = useCallback(async (channelId: string) => {
    setBusy(true)
    try {
      const result = await api().deleteChannel(channelId)
      setError(result.ok ? null : result.error)
      if (result.ok) setRemoval(null)
    } finally {
      setBusy(false)
    }
  }, [])

  let overlay: ReactNode = null
  if (removal) {
    overlay = createPortal(
      <DeleteChannelDialog
        removal={removal}
        busy={busy}
        error={error}
        onCancel={cancel}
        onConfirm={() => void confirm(removal.channelId)}
      />,
      document.body,
    )
  } else if (error) {
    overlay = createPortal(
      <div className="fixed right-16 bottom-16 z-40 max-w-420 font-sans">
        <Alert variant="error" title={error} onClose={() => setError(null)} />
      </div>,
      document.body,
    )
  }

  return { ask, overlay }
}

/** The confirmation: the channel, its messages and what else goes, because this cannot be undone. */
export function DeleteChannelDialog(props: {
  removal: ChannelRemoval
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
        aria-labelledby="delete-channel-title"
        aria-describedby="delete-channel-body"
      >
        <div className="flex gap-14 px-20 pt-20 pb-16">
          <span
            className="flex size-36 shrink-0 items-center justify-center rounded-sm bg-status-error text-status-error-foreground"
            aria-hidden
          >
            <Trash2 size={18} />
          </span>
          <div className="flex min-w-0 shrink grow basis-0 flex-col gap-6">
            <h2 className="m-0 font-bold text-16 text-foreground [overflow-wrap:anywhere]" id="delete-channel-title">
              {deleteChannelTitle(props.removal)}
            </h2>
            <p className="m-0 text-12-5/18 text-muted-foreground" id="delete-channel-body">
              {deleteChannelBody(props.removal)}
            </p>
          </div>
        </div>
        {props.error && <Alert variant="error" title={props.error} className="mt-0 mr-20 mb-14 ml-20" />}
        <div className="flex justify-end gap-10 border-border border-t px-20 pt-13 pb-14">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="toolbar" icon={Trash2} disabled={busy} onClick={props.onConfirm}>
            Delete channel
          </Button>
        </div>
      </div>
    </div>
  )
}
