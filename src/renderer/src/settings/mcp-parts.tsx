import { Server } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
import '../ui/tailwind.css'

/*
 * What the three Integrations sections draw with (T136, T235, T242).
 *
 * "In this Company", "Found on this machine" and "Popular" are the same row at three moments of
 * its life, and they all open the same modal, so the row's boxes and that modal live here rather
 * than three times over. Frames `uApL8`, `qSIIY`, `mPqN9` and `gue8i`.
 */

/** The line a card with nothing in it writes under its head (frames `o9BFgz`, `JmtHi`). */
export const NONE = 'm-0 text-12-5/[1.5] text-muted-foreground'

export const NOTE = 'm-0 text-12-5/19 text-muted-foreground'

/** The rows of a card sit in their own list, 8px apart: the card's 14px is for head, list, button. */
export const LIST = 'flex flex-col gap-8'

/*
 * A row is the card's own tone, outlined by the border rather than a well of page background. The
 * frame's 10px 12px padding holds its stroke, so the 1px border takes from it. The colour is not
 * in this list: a skill whose folder has moved outlines itself in amber, and two utilities on one
 * property have to be exclusive or the sheet's order decides which one you get.
 */
export const ROW_BASE = 'flex items-center gap-12 rounded-sm border bg-muted px-11 py-9'
export const ROW_EDGE = 'border-border'

export const ROW_TEXT = 'flex min-w-0 flex-[1_1_auto] flex-col gap-3'
export const ROW_HEAD = 'flex items-center gap-8'
export const ROW_NAME = 'text-13/[inherit] font-semibold text-foreground'

/** 15, the box `uApL8` draws it in: at 14 every row came out a pixel short and the cards climbed. */
export const ROW_TARGET = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11-5/15 text-muted-foreground'

/** A name muted, for a row that cannot be added at all. */
export const ROW_NAME_OFF = 'text-13/[inherit] font-semibold text-muted-foreground'

/** The variables whose values would go to the store, by name. Never a value. */
export const ROW_SECRETS = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11/14 text-muted-foreground'
export const ROW_NOTE = 'shrink-0 text-right text-11/14 text-muted-foreground'

/**
 * The centred modal, as T49 drew New ticket. The scrim is the token every other dialog in the app
 * draws — `#0b1220cc`, which is what the modal frames paint (T235); this tab had it as black at
 * 55%, and the Import dialog's pair against `qSIIY` is where that finally showed.
 */
export const OVERLAY = 'fixed inset-0 z-60 flex items-center justify-center bg-scrim p-24'
export const MODAL = 'flex max-h-full w-520 max-w-full flex-col rounded-md border border-border bg-card font-sans'
export const MODAL_HEAD = 'flex items-start gap-10 border-b border-border px-18 py-16 text-primary'
export const MODAL_TITLE = 'text-14/[inherit] font-bold text-foreground'
export const MODAL_SUB = 'mt-2 text-11-5/[inherit] text-muted-foreground'
export const MODAL_BODY = 'flex flex-col gap-12 overflow-y-auto px-18 py-16'
export const MODAL_FOOT = 'flex justify-end gap-8 border-t border-border px-18 py-14'

/** The centred modal every Integrations form opens in, in the shape T49 gave New ticket. */
export function Modal(props: {
  title: string
  sub: string
  submit: string
  ready: boolean
  /** The mark in the modal's header; the MCP forms keep the server. A preset draws its logo. */
  mark?: ReactNode
  destructive?: boolean
  onSubmit(): void
  onCancel(): void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  // A portal onto the body, outside Company settings' own `<form>`: a form inside a form never
  // reaches React's submit handler, and Chromium submits the outer one instead (T218). Rendered to
  // a string there is no body and no submit, so the markup stays where it is written.
  const dialog = (
    <div className={OVERLAY} onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (props.ready) props.onSubmit()
        }}
      >
        <header className={MODAL_HEAD}>
          {props.mark ?? <Server size={16} aria-hidden />}
          <div>
            <div className={MODAL_TITLE}>{props.title}</div>
            <div className={MODAL_SUB}>{props.sub}</div>
          </div>
        </header>
        <div className={MODAL_BODY}>{props.children}</div>
        <footer className={MODAL_FOOT}>
          <Button variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant={props.destructive ? 'destructive' : 'primary'} disabled={!props.ready}>
            {props.submit}
          </Button>
        </footer>
      </form>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
