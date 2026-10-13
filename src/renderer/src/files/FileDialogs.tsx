import { FilePlus2, GitCompareArrows, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { discardQuestion, discardWarning } from '../../../shared/files/file-changes'
import { type FileConflict, newFilePath, newFileRefusal, newFileStart } from '../../../shared/files/file-edits'
import { type FilePlace, placeLabel } from '../../../shared/files/files'
import { Alert, Button, cx, InputGroup } from '../ui'
import { conflictBody, conflictTitle, unsavedBody, unsavedTitle } from './editing-model'
import '../ui/tailwind.css'

/** Escape closes any of these, and the dialog takes the focus when it opens. */
function useDialogKeys(onCancel: () => void, busy = false) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement | HTMLInputElement>('input, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel, busy])
  return dialog
}

/**
 * The four dialogs editing needs: a new file, unsaved work, the two versions of a save that stopped,
 * and a discard. They sit on the code surface, because that is what is behind them.
 *
 * The overlay writes `line-height: normal` for itself: it is `position: fixed` on `document.body`,
 * outside the shell that declares it for everything else.
 */
const OVERLAY = 'fixed inset-0 z-200 flex items-center justify-center bg-modal-scrim p-32 font-sans leading-[normal]'

const DIALOG = 'flex w-[min(520px,100%)] flex-col gap-16 rounded-md border border-border bg-card p-24 shadow-overlay'

const ICON =
  'flex size-36 shrink-0 items-center justify-center rounded-sm bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-primary'

const ICON_WARN =
  'flex size-36 shrink-0 items-center justify-center rounded-sm bg-[color-mix(in_srgb,var(--brand-warning)_16%,transparent)] text-brand-warning'

const TITLE = 'm-0 font-semibold text-15/[normal]'

const SUB = 'mt-4 mr-0 mb-0 ml-0 text-12-5/[1.5] text-muted-foreground'

/* Both versions of a save that stopped, side by side. */
const SIDE = 'flex min-w-0 flex-col overflow-hidden rounded-sm border border-border'

const SIDE_MINE =
  'flex min-w-0 flex-col overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]'

const SIDE_TITLE =
  'm-0 border-b border-border bg-sidebar px-12 py-6 font-semibold text-11/[normal] tracking-[0.04em] uppercase text-muted-foreground'

const SIDE_TEXT =
  'm-0 max-h-320 overflow-auto bg-code p-12 font-code text-12/[1.6] text-syntax-plain whitespace-pre-wrap'

/**
 * New file: the boss names a path inside the place, starting at the folder the tree has chosen.
 * A name the place already has, or a path that climbs out of it, is refused with the reason —
 * here where it can be typed again, and again in the main process, which trusts none of this.
 */
export function NewFileDialog({
  place,
  folder,
  busy = false,
  error = null,
  onCancel,
  onCreate,
}: {
  place: FilePlace
  /** The folder the tree has chosen; the box starts inside it. */
  folder: string | null
  busy?: boolean
  /** What the main process refused it for, once it has been asked. */
  error?: string | null
  onCancel(): void
  onCreate(path: string): void
}) {
  const start = newFileStart(folder)
  const [typed, setTyped] = useState(start)
  const dialog = useDialogKeys(onCancel, busy)
  const wanted = newFilePath('', typed)
  // The box opens on the folder the tree chose, which is not yet a name: it waits to be told off
  // until the boss has typed one.
  const named = typed.trim() !== '' && typed !== start
  const refusal = named ? newFileRefusal(wanted) : null
  const ready = named && refusal === null

  return (
    <div className={OVERLAY} onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        ref={dialog}
        className={DIALOG}
        role="dialog"
        aria-modal="true"
        aria-labelledby="files-new-title"
        data-ui="New file"
      >
        <div className="flex items-start gap-12">
          <span className={ICON} aria-hidden>
            <FilePlus2 size={18} />
          </span>
          <div>
            <h2 className={TITLE} id="files-new-title">
              New file
            </h2>
            <p className={SUB}>Inside {placeLabel(place)}</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-16"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !busy) onCreate(wanted)
          }}
        >
          <InputGroup
            label="Path"
            value={typed}
            error={refusal !== null}
            helper={refusal ?? 'The path is inside this place, folders and all: they are made if they are missing.'}
            placeholder="docs/notes.md"
            disabled={busy}
            onChange={(event) => setTyped(event.target.value)}
          />
          {error && <Alert variant="error" title={error} className="m-0" />}
          <div className="flex justify-end gap-8">
            <Button type="button" variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="toolbar" icon={FilePlus2} disabled={!ready || busy}>
              Create file
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * The ask before unsaved work would go: leaving a tab, or the view, with something the disk has
 * not seen. Save writes it, Discard puts the file back, Cancel stays where the boss is.
 */
export function UnsavedDialog({
  path,
  others = 0,
  busy = false,
  error = null,
  onCancel,
  onDiscard,
  onSave,
}: {
  path: string
  /** How many other tabs are edited too, which leaving the view has to say. */
  others?: number
  busy?: boolean
  error?: string | null
  onCancel(): void
  onDiscard(): void
  onSave(): void
}) {
  const dialog = useDialogKeys(onCancel, busy)
  return (
    <div className={OVERLAY} onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        ref={dialog}
        className={DIALOG}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="files-unsaved-title"
        aria-describedby="files-unsaved-body"
        data-ui="Unsaved work"
      >
        <div className="flex items-start gap-12">
          <span className={ICON_WARN} aria-hidden>
            <TriangleAlert size={18} />
          </span>
          <div>
            <h2 className={TITLE} id="files-unsaved-title">
              {unsavedTitle(path)}
            </h2>
            <p className={SUB} id="files-unsaved-body">
              {unsavedBody(path, others)}
            </p>
          </div>
        </div>
        {error && <Alert variant="error" title={error} className="m-0" />}
        <div className="flex justify-end gap-8">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="toolbar" disabled={busy} onClick={onDiscard}>
            Discard changes
          </Button>
          <Button size="toolbar" disabled={busy} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Never clobber: the save stopped because the file changed underneath, so both versions are here
 * — theirs, on disk, and the boss's own — and the boss picks. Nothing was overwritten to get here.
 */
export function ConflictDialog({
  conflict,
  holderName,
  busy = false,
  error = null,
  onCancel,
  onTakeTheirs,
  onKeepMine,
}: {
  conflict: FileConflict
  holderName: string | null
  busy?: boolean
  error?: string | null
  onCancel(): void
  onTakeTheirs(): void
  onKeepMine(): void
}) {
  const dialog = useDialogKeys(onCancel, busy)
  return (
    <div className={OVERLAY} onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        ref={dialog}
        className={cx(DIALOG, 'w-[min(880px,100%)]')}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="files-conflict-title"
        aria-describedby="files-conflict-body"
        data-ui="Save conflict"
      >
        <div className="flex items-start gap-12">
          <span className={ICON_WARN} aria-hidden>
            <GitCompareArrows size={18} />
          </span>
          <div>
            <h2 className={TITLE} id="files-conflict-title">
              {conflictTitle(conflict.path)}
            </h2>
            <p className={SUB} id="files-conflict-body">
              {conflictBody(holderName)}
            </p>
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-[1fr_1fr] gap-12">
          <Version title={`Theirs, on disk`} text={conflict.theirs} />
          <Version title="Yours, in the editor" text={conflict.yours} mine />
        </div>
        {error && <Alert variant="error" title={error} className="m-0" />}
        <div className="flex justify-end gap-8">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Keep editing
          </Button>
          <Button variant="ghost" size="toolbar" disabled={busy} onClick={onTakeTheirs}>
            Take theirs
          </Button>
          <Button size="toolbar" disabled={busy} onClick={onKeepMine}>
            Keep mine
          </Button>
        </div>
      </div>
    </div>
  )
}

function Version({ title, text, mine = false }: { title: string; text: string; mine?: boolean }) {
  return (
    <section className={mine ? SIDE_MINE : SIDE}>
      <h3 className={SIDE_TITLE}>{title}</h3>
      <pre className={SIDE_TEXT}>{text}</pre>
    </section>
  )
}

/**
 * Discard is the one action in the Changes tab that loses something uncommitted and unrecoverable,
 * so it is asked about, and it names the files (T160). Where the place is a ticket worktree a
 * restore point is taken first, which the question says, because a discard a restore point can
 * undo is a different thing from one that cannot.
 */
export function DiscardDialog({
  paths,
  restorable,
  busy = false,
  error = null,
  onCancel,
  onDiscard,
}: {
  /** Every path the discard would throw away, which the dialog lists. */
  paths: readonly string[]
  /** True where the place is a ticket worktree, so T118 can put it back. */
  restorable: boolean
  busy?: boolean
  error?: string | null
  onCancel(): void
  onDiscard(): void
}) {
  const dialog = useDialogKeys(onCancel, busy)
  return (
    <div className={OVERLAY} onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        ref={dialog}
        className={DIALOG}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="files-discard-title"
        aria-describedby="files-discard-body"
        data-ui="Discard changes"
      >
        <div className="flex items-start gap-12">
          <span className={ICON_WARN} aria-hidden>
            <TriangleAlert size={18} />
          </span>
          <div>
            <h2 className={TITLE} id="files-discard-title">
              {discardQuestion(paths)}
            </h2>
            <p className={SUB} id="files-discard-body">
              {discardWarning(restorable)}
            </p>
          </div>
        </div>
        <ul className="mt-0 mr-0 mb-12 ml-0 list-none p-0">
          {paths.map((path) => (
            <li key={path} className="py-2 font-code text-12/[normal] text-muted-foreground">
              {path}
            </li>
          ))}
        </ul>
        {error && <Alert variant="error" title={error} className="m-0" />}
        <div className="flex justify-end gap-8">
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Keep them
          </Button>
          <Button variant="destructive" size="toolbar" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  )
}
