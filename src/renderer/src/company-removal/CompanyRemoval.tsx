import { FolderMinus, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Company } from '../../../shared/company'
import { Alert, Button, DropdownMenu, MenuItem } from '../ui'
import { DELETE_LABEL, deleteBody, deleteTitle, REMOVE_LABEL } from './removal-text'
import '../ui/tailwind.css'

/*
 * Remove from launcher / Delete company… (T58). The overlay's dim is `--scrim` and the Danger
 * zone's edge is `--danger-edge`, both added to `ui/tokens.css` by this ticket — they were the two
 * hexes this stylesheet carried.
 *
 * `leading-[normal]` on each root that had `line-height: normal`, and `/[inherit]` on the sizes
 * under it, because the frame sets these on the font's own metrics rather than the scale's.
 */
const MENU = 'fixed z-40 font-sans leading-[normal]'

const ERROR_TOAST = 'fixed right-16 bottom-16 z-40 max-w-420 font-sans'

const OVERLAY = 'fixed inset-0 z-40 flex items-center justify-center bg-scrim p-24 font-sans leading-[normal]'

const DIALOG = 'flex w-460 max-w-full flex-col rounded-md border border-border bg-card shadow-overlay'

const DIALOG_ICON =
  'flex size-36 shrink-0 items-center justify-center rounded-sm bg-status-error text-status-error-foreground'

/** 16px on 19px and 12.5px on 18px are both the frame's, not the scale's pairing. */
const DIALOG_TITLE = 'm-0 text-16 font-bold text-foreground'
const DIALOG_SUB = 'm-0 text-12-5/18 text-muted-foreground'

const FOLDER =
  '[overflow-wrap:anywhere] rounded-[6px] bg-secondary px-8 py-6 font-code text-12/[inherit] text-foreground'

const FOOTER = 'flex justify-end gap-10 border-t border-border px-20 pt-13 pb-14'

/** The red-bordered card of design/html/company-settings.html: Danger zone. */
const DANGER = 'flex flex-col gap-14 rounded-md border border-danger-edge bg-card p-18'

const DANGER_TITLE = 'm-0 text-14/[inherit] font-bold text-status-error-foreground'
const DANGER_SUB = 'm-0 text-11-5 text-muted-foreground'

type Removable = Pick<Company, 'id' | 'name' | 'folder'>

/** Where a Company's actions menu opens: at a right click, or under the `…` button. */
export interface MenuAnchor {
  x: number
  y: number
}

export interface CompanyRemoval {
  /** Opens the actions menu for `company` at `anchor`. */
  openMenu(company: Removable, anchor: MenuAnchor): void
  /** Remove from launcher: acts at once, the folder stays. */
  forget(company: Removable): void
  /** Delete company…: asks first. */
  askDelete(company: Removable): void
  /** The open menu or confirmation, rendered into `document.body`. */
  overlay: ReactNode
}

/**
 * Remove from launcher and Delete company… for any Company the boss can see: the Launcher rows, the
 * rail's avatars and Company settings share it. The engine announces the change; `onRemoved` runs after.
 */
export function useCompanyRemoval(onRemoved?: (company: Removable) => void): CompanyRemoval {
  const [menu, setMenu] = useState<{ company: Removable; anchor: MenuAnchor } | null>(null)
  const [deleting, setDeleting] = useState<Removable | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (company: Removable, kind: 'forget' | 'delete') => {
      setBusy(true)
      try {
        const api = window.tinyCorp.company
        const result = await (kind === 'forget' ? api.forget(company.id) : api.delete(company.id))
        setError(result.ok ? null : result.error)
        if (!result.ok) return
        setDeleting(null)
        onRemoved?.(company)
      } finally {
        setBusy(false)
      }
    },
    [onRemoved],
  )

  const forget = useCallback(
    (company: Removable) => {
      setMenu(null)
      setDeleting(null)
      void run(company, 'forget')
    },
    [run],
  )

  const askDelete = useCallback((company: Removable) => {
    setMenu(null)
    setError(null)
    setDeleting(company)
  }, [])

  const openMenu = useCallback((company: Removable, anchor: MenuAnchor) => {
    setError(null)
    setMenu({ company, anchor })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])
  const cancelDelete = useCallback(() => {
    setDeleting(null)
    setError(null)
  }, [])

  let overlay: ReactNode = null
  if (deleting) {
    overlay = createPortal(
      <DeleteCompanyDialog
        company={deleting}
        busy={busy}
        error={error}
        onCancel={cancelDelete}
        onConfirm={() => void run(deleting, 'delete')}
      />,
      document.body,
    )
  } else if (menu) {
    overlay = createPortal(
      <CompanyActionsMenu
        anchor={menu.anchor}
        onClose={closeMenu}
        onForget={() => forget(menu.company)}
        onDelete={() => askDelete(menu.company)}
      />,
      document.body,
    )
  } else if (error) {
    overlay = createPortal(
      <div className={ERROR_TOAST}>
        <Alert variant="error" title={error} onClose={() => setError(null)} />
      </div>,
      document.body,
    )
  }

  return { openMenu, forget, askDelete, overlay }
}

/** The menu anchor for a right click. */
export function pointerAnchor(event: { clientX: number; clientY: number }): MenuAnchor {
  return { x: event.clientX, y: event.clientY }
}

/** The menu anchor under an element, e.g. a `…` button: right-aligned to it. */
export function elementAnchor(element: Element): MenuAnchor {
  const box = element.getBoundingClientRect()
  return { x: box.right - MENU_WIDTH, y: box.bottom + 4 }
}

const MENU_WIDTH = 220

/** The two actions, as a floating Dropdown Menu. Escape or a click elsewhere closes it. */
export function CompanyActionsMenu(props: { anchor: MenuAnchor; onClose(): void; onForget(): void; onDelete(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = props

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer, true)
    // Capture, so the Launcher's own Escape and arrow keys wait until the menu is gone.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const x = Math.max(8, Math.min(props.anchor.x, window.innerWidth - MENU_WIDTH - 8))
  const y = Math.max(8, Math.min(props.anchor.y, window.innerHeight - 100))
  return (
    <div ref={ref} className={MENU} style={{ left: x, top: y, width: MENU_WIDTH }}>
      <CompanyActionsList onForget={props.onForget} onDelete={props.onDelete} />
    </div>
  )
}

/** The menu's items; static so it renders without a DOM. */
export function CompanyActionsList(props: { onForget(): void; onDelete(): void }) {
  return (
    <DropdownMenu aria-label="Company actions">
      <MenuItem icon={FolderMinus} label={REMOVE_LABEL} onClick={props.onForget} />
      <MenuItem icon={Trash2} label={DELETE_LABEL} destructive onClick={props.onDelete} />
    </DropdownMenu>
  )
}

/** The confirmation before Delete company…, naming the folder. */
export function DeleteCompanyDialog(props: {
  company: Removable
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
    <div className={OVERLAY} onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        ref={dialog}
        className={DIALOG}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="company-removal-title"
        aria-describedby="company-removal-body"
      >
        <div className="flex gap-14 px-20 pt-20 pb-16">
          <span className={DIALOG_ICON} aria-hidden>
            <Trash2 size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <h2 className={DIALOG_TITLE} id="company-removal-title">
              {deleteTitle(props.company)}
            </h2>
            <p className={DIALOG_SUB} id="company-removal-body">
              {deleteBody(props.company)}
            </p>
            <code className={FOLDER}>{props.company.folder}</code>
          </div>
        </div>
        {props.error && <Alert variant="error" title={props.error} className="mx-20 mb-14" />}
        <div className={FOOTER}>
          <Button variant="outline" size="toolbar" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="toolbar" icon={Trash2} disabled={busy} onClick={props.onConfirm}>
            Delete company
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Company settings' Danger zone (design/html/company-settings.html): both actions for the open Company. */
export function DangerZone(props: { onForget(): void; onDelete(): void }) {
  return (
    <section className={DANGER} aria-label="Danger zone">
      <div className="flex flex-col gap-2">
        <h2 className={DANGER_TITLE}>Danger zone</h2>
        <p className={DANGER_SUB}>
          Removing forgets the Company and leaves its folder as it is. Deleting also removes its data from the folder;
          connected repos stay.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-10">
        <Button variant="outline" size="toolbar" icon={FolderMinus} onClick={props.onForget}>
          {REMOVE_LABEL}
        </Button>
        <Button variant="destructive" size="toolbar" icon={Trash2} onClick={props.onDelete}>
          {DELETE_LABEL}
        </Button>
      </div>
    </section>
  )
}
