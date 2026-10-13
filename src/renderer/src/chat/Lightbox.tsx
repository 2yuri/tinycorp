import { FolderOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sizeLabel } from '../../../shared/files/files'
import '../ui/tailwind.css'
import { machineWordsHere } from '../chrome'

/**
 * An image chat has already read: what the thumbnail draws and what the lightbox says about it
 * (T236). It is the same shape whether an Employee attached the file or only wrote its path.
 */
export interface LightboxImage {
  name: string
  /** `data:image/png;base64,…`; the main process is the only place that reads bytes. */
  dataUrl: string
  /** Its size on disk in bytes, or null when nobody counted them. */
  size: number | null
  /** Where the file is on this machine, for Reveal; null when there is nowhere to reveal it. */
  path: string | null
}

/** How big a thumbnail in a message may be: enough to recognise, never enough to take the row. */
const THUMBNAIL = 'block max-h-132 max-w-220 object-contain'

const FRAME =
  'cursor-pointer overflow-hidden rounded-sm border border-border bg-card p-0 leading-0 hover:border-ring focus-visible:shadow-focus'

/* The scrim: the whole window under it, the image in the middle, what it is written under that. */
const SCRIM = 'fixed inset-0 z-60 flex flex-col items-center justify-center gap-16 bg-[#020617e0] p-48'

const REVEAL =
  'inline-flex shrink-0 cursor-pointer items-center gap-6 rounded-sm border border-border-strong bg-transparent px-10 py-4 font-sans text-11/[normal] text-muted-foreground hover:text-foreground focus-visible:shadow-focus'

const CLOSE =
  'absolute top-24 right-40 flex size-32 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus-visible:shadow-focus'

/**
 * An image in a message: a thumbnail, and the lightbox a click on it opens (frame `dzQXx`).
 *
 * The lightbox belongs to the thumbnail that opened it rather than to the channel: a message draws
 * as many as it carries, and only the one clicked has anything open.
 */
export function ImagePreview({ image }: { image: LightboxImage }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-ui="Image thumbnail"
        className={FRAME}
        title={`${image.name}${image.size === null ? '' : ` · ${sizeLabel(image.size)}`}`}
        aria-label={`Open ${image.name}`}
        onClick={() => setOpen(true)}
      >
        <img className={THUMBNAIL} src={image.dataUrl} alt={image.name} />
      </button>
      {open && <Lightbox image={image} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * One image over the whole window. Esc closes it, and so does a click anywhere but the picture and
 * the line under it — the two ways out the frame promises, and the only two there are.
 *
 * It is drawn into `document.body` rather than into the message it came from: a message row is
 * inside a scrolling column with its own stacking context, and a lightbox that scrolls with the
 * conversation is not one.
 */
export function Lightbox({ image, onClose }: { image: LightboxImage; onClose(): void }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const facts = [size && `${size.width} × ${size.height}`, image.size !== null && sizeLabel(image.size)]
    .filter(Boolean)
    .join(' · ')
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is the keyboard's way out, on the document.
    <div
      className={SCRIM}
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      data-ui="Lightbox"
      // Outside is the scrim itself: a click that lands on the picture, its line or the hint under
      // it never reaches here, so nothing inside the lightbox has to stop the event by hand.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {/* The column is the picture's own width, so the line under it is as wide as what it names. */}
      <div className="flex w-fit max-w-full flex-col items-center gap-12">
        <img
          // The window less the padding, the line under the picture and the hint under that: a
          // percentage cannot say it, because this column is sized by the picture and not the other
          // way round. As in the Files viewer, a small picture is never blown up to fill the room.
          className="max-h-[calc(100vh-180px)] max-w-full object-contain"
          src={image.dataUrl}
          alt={image.name}
          onLoad={(event) =>
            setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
        />
        <div className="flex w-full min-w-320 items-center gap-12">
          <span className="font-code text-13/[normal] text-foreground">{image.name}</span>
          <span className="font-code text-12/[normal] text-muted-foreground">{facts}</span>
          <span className="flex-1" />
          {image.path !== null && <Reveal path={image.path} />}
        </div>
      </div>
      <p className="m-0 text-12/[normal] text-muted-foreground">Esc, or click outside, to close</p>
      <button type="button" className={CLOSE} aria-label="Close" onClick={onClose}>
        <X size={18} aria-hidden />
      </button>
    </div>,
    document.body,
  )
}

/** The one thing the boss can do with the file that the app itself cannot: open it where it is. */
function Reveal({ path }: { path: string }) {
  return (
    <button type="button" className={REVEAL} onClick={() => void window.tinyCorp.paths.reveal(path)}>
      <FolderOpen size={12} aria-hidden />
      {machineWordsHere().reveal}
    </button>
  )
}
