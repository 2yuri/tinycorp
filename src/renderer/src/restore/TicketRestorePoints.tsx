import { Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RETENTION_DAYS, type RestoreLoss, type RestorePoint, shortCommit } from '../../../shared/restore-points'
import { Button } from '../ui'
import { goBackBody, goBackTitle, pointLine, REASON_LABEL, retentionNote } from './restore-points-model'
import '../ui/tailwind.css'

/** Read at call time, so the list and the dialog render in a test without a window. */
const api = () => window.tinyCorp.restorePoints

/**
 * A ticket's restore points: when each was taken and what the Employee said it was doing, with the
 * way back to one. Shows nothing until the ticket has a worktree (T118).
 */
export function TicketRestorePoints({ ticketId, repoName }: { ticketId: number; repoName(id: string): string }) {
  const [points, setPoints] = useState<RestorePoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ point: RestorePoint; loss: RestoreLoss } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const result = await api().of(ticketId)
    if (!result.ok) return setError(result.error)
    setError(null)
    setPoints(result.value)
  }, [ticketId])

  useEffect(() => {
    void refresh()
    return api().onChanged(() => void refresh())
  }, [refresh])

  const ask = useCallback(async (point: RestorePoint) => {
    const result = await api().losses(point.id)
    if (!result.ok) return setError(result.error)
    setError(null)
    setAsking({ point, loss: result.value })
  }, [])

  const goBack = useCallback(async (point: RestorePoint) => {
    setBusy(true)
    const result = await api().goBack(point.id)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setError(null)
    setAsking(null)
  }, [])

  if (points.length === 0) return error ? <p className="text-destructive">{error}</p> : null
  const now = new Date()
  return (
    <section className="flex flex-col gap-6" aria-label="Restore points">
      <h4 className="m-0 whitespace-nowrap font-bold font-sans text-11/[normal] text-muted-foreground uppercase tracking-[0.5px]">
        Restore points
      </h4>
      <div className="rounded-sm border border-border bg-card p-10">
        <RestorePointList points={points} now={now} repoName={repoName} onGoBack={(point) => void ask(point)} />
      </div>
      <p className="m-0 text-11/16 text-muted-foreground">{retentionNote(RETENTION_DAYS)}</p>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {asking &&
        createPortal(
          <GoBackDialog
            point={asking.point}
            loss={asking.loss}
            repo={repoName(asking.point.repoId)}
            busy={busy}
            onCancel={() => setAsking(null)}
            onConfirm={() => void goBack(asking.point)}
          />,
          document.body,
        )}
    </section>
  )
}

/** The list itself; static so it renders without a DOM. */
export function RestorePointList({
  points,
  now,
  repoName,
  onGoBack,
}: {
  points: RestorePoint[]
  now: Date
  repoName(id: string): string
  onGoBack(point: RestorePoint): void
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-8 p-0">
      {points.map((point) => {
        const line = pointLine(point, now)
        return (
          <li key={point.id} className="flex items-start justify-between gap-10">
            <div className="flex min-w-0 flex-[1_1_0] flex-wrap items-baseline gap-x-8 gap-y-4">
              <span className="font-code text-11/[inherit] text-muted-foreground">{line.when}</span>
              <span className="font-semibold text-12/[inherit] text-foreground">{line.kind}</span>
              {line.note && (
                <span className="flex-[1_1_100%] overflow-hidden text-ellipsis whitespace-nowrap text-12/[inherit] text-foreground">
                  {line.note}
                </span>
              )}
              <span className="flex-[1_1_100%] text-11/[inherit] text-muted-foreground">
                {repoName(point.repoId)} · <code>{shortCommit(point.commit)}</code>
                {point.hadUncommitted && ' · with uncommitted work'}
              </span>
            </div>
            <Button variant="outline" size="toolbar" icon={Undo2} onClick={() => onGoBack(point)}>
              Go back
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

/** The confirmation before going back, naming what stops and what is lost. */
export function GoBackDialog(props: {
  point: RestorePoint
  loss: RestoreLoss
  repo: string
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const { onCancel, busy } = props
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Cancel takes the focus, so a stray Enter never throws work away.
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-24 font-sans leading-[normal]"
      onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}
    >
      <div
        ref={dialog}
        className="flex w-460 max-w-full flex-col rounded-md border border-border bg-card shadow-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ticket-restore-title"
        aria-describedby="ticket-restore-body"
      >
        <div className="flex gap-14 px-20 pt-20 pb-16">
          <span
            className="flex size-36 shrink-0 items-center justify-center rounded-sm bg-status-warning text-status-warning-foreground"
            aria-hidden
          >
            <Undo2 size={18} />
          </span>
          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-6">
            <h2 className="m-0 font-bold text-16 text-foreground" id="ticket-restore-title">
              {goBackTitle(props.point)}
            </h2>
            <p className="m-0 text-12-5/18 text-muted-foreground" id="ticket-restore-body">
              {goBackBody(props.point, props.loss, props.repo)}
            </p>
            <code className="wrap-anywhere rounded-[6px] bg-secondary px-8 py-6 font-code text-12/[inherit] text-foreground">
              {REASON_LABEL[props.point.reason]} · {shortCommit(props.point.commit)}
            </code>
          </div>
        </div>
        <div className="flex justify-end gap-10 border-border border-t px-20 pt-13 pb-14">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="toolbar" icon={Undo2} disabled={busy} onClick={props.onConfirm}>
            Go back
          </Button>
        </div>
      </div>
    </div>
  )
}
