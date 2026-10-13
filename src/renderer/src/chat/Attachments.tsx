import { FileText, Paperclip, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Attachment, isImageAttachment, type OpenedAttachment } from '../../../shared/attachments'
import { sizeLabel } from '../../../shared/files/files'
import { machineWordsHere } from '../chrome'
import { cx } from '../ui'
import { ImagePreview } from './Lightbox'

/**
 * The design's soft body ink in chat: Slate 300 on the dark theme, the secondary ink on light.
 * `ui/tokens.css` has no token for it — the stylesheet carried it as a `--chat-soft` custom
 * property with a `[data-theme='light']` override, and this is that pair, per element. T208 could
 * name it; this ticket may not decide it.
 */
const SOFT = "text-[#cbd5e1] [[data-theme='light']_&]:text-secondary-foreground"

/** The chip the repo chips and the attachments share. */
const CHIP =
  'inline-flex items-center gap-6 whitespace-nowrap rounded-full bg-secondary px-10 py-4 font-code font-normal text-11/[normal] [&_svg]:text-muted-foreground'

/**
 * What a message carries (decision 37): images as a thumbnail where they were sent, everything
 * else as the kit's chip. A click on a thumbnail opens the lightbox (T236); a click on a chip
 * hands the file to Finder, which is the only place the boss can do more with that one.
 */
export function AttachedFiles({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      {attachments.map((attachment) =>
        isImageAttachment(attachment) ? (
          <AttachedImage key={attachment.id} attachment={attachment} />
        ) : (
          <AttachedChip key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  )
}

function AttachedImage({ attachment }: { attachment: Attachment }) {
  const opened = useAttachment(attachment.id)
  // An image the engine would not read — too big, or gone from the folder — is still a file the
  // boss can open themselves, so it falls back to the chip rather than to nothing.
  if (!opened?.dataUrl) {
    return <AttachedChip attachment={attachment} />
  }
  return (
    <ImagePreview
      image={{ name: attachment.name, dataUrl: opened.dataUrl, size: attachment.size, path: opened.path }}
    />
  )
}

function AttachedChip({ attachment }: { attachment: Attachment }) {
  const opened = useAttachment(attachment.id)
  return (
    <button
      type="button"
      data-attachment-chip
      className={cx(
        CHIP,
        SOFT,
        'cursor-pointer border-0 disabled:cursor-default disabled:opacity-60',
        'hover:not-disabled:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground)_8%)]',
      )}
      title={`Show ${attachment.name} in ${machineWordsHere().fileManager}`}
      disabled={!opened}
      onClick={() => opened && void reveal(opened.path)}
    >
      <FileText size={12} aria-hidden />
      {attachment.name}
      <span className="text-muted-foreground">{sizeLabel(attachment.size)}</span>
    </button>
  )
}

/**
 * What was read for each attachment, kept for as long as the Company is open: an image crosses the
 * IPC boundary as a data URL, and scrolling a channel must not read it again every time a row mounts.
 */
const read = new Map<number, Promise<OpenedAttachment | null>>()

/** One attachment read from the main process, once per id. */
function useAttachment(id: number): OpenedAttachment | null {
  const [opened, setOpened] = useState<OpenedAttachment | null>(null)
  useEffect(() => {
    let live = true
    let pending = read.get(id)
    if (!pending) {
      pending = window.tinyCorp.chat.attachment(id).then((result) => (result.ok ? result.value : null))
      read.set(id, pending)
    }
    void pending.then((value) => {
      if (live) setOpened(value)
    })
    return () => {
      live = false
    }
  }, [id])
  return opened
}

async function reveal(path: string): Promise<void> {
  await window.tinyCorp.paths.reveal(path)
}

/**
 * A file the boss picked but has not sent yet, held by the composer. One picked just now has its
 * `File`; one restored from a draft has only its `path`, and the main process reads it on send.
 */
export interface PendingAttachment {
  key: string
  name: string
  size: number
  file?: File
  /** Where it is on disk; empty for a file that has no path, like a pasted image (TI-1). */
  path?: string
}

/** The row of files under the composer, each with a way to take it back off. */
export function PendingAttachments(props: { attachments: PendingAttachment[]; onRemove(key: string): void }) {
  if (props.attachments.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-8">
      {props.attachments.map((attachment) => (
        <span key={attachment.key} data-attachment-chip className={cx(CHIP, SOFT, 'border-0')}>
          <Paperclip size={12} aria-hidden />
          {attachment.name}
          <span className="text-muted-foreground">{sizeLabel(attachment.size)}</span>
          <button
            type="button"
            className="ml-2 inline-flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${attachment.name}`}
            title={`Remove ${attachment.name}`}
            onClick={() => props.onRemove(attachment.key)}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  )
}
