import { ClipboardCopy, RefreshCw, Unplug } from 'lucide-react'
import { type CrashReport, crashOrigin, formatCrashReport } from '../../../../shared/app/crash'
import { Button, cx } from '../../ui'
import '../../ui/tailwind.css'

export interface CrashCardProps {
  report: CrashReport
  /** `Board · Tiny Corp`, or the app's own name when the throw was outside every view. */
  where: string
  /** Remounts the view the boundary is wrapping. */
  onReload(): void
  /** Overridden in tests; the card writes to the system clipboard. */
  onCopy?(text: string): void
  /** The last resort, with no shell behind it: the card centres itself in the whole window. */
  alone?: boolean
}

/**
 * The card a screen that stopped drawing puts in the content area (design/screens/Y6xWi.png, frame
 * `Y6xWi` — Something Broke). It says what stopped, that the work is safe, what broke and where it
 * came from, and offers the two things the boss can do about it.
 */
export function CrashCard({ report, where, onReload, onCopy, alone }: CrashCardProps) {
  const copy = () => {
    const text = formatCrashReport(report)
    if (onCopy) return onCopy(text)
    void navigator.clipboard?.writeText(text)
  }

  return (
    <div className={alone ? cx(SCREEN, 'min-h-screen') : SCREEN} role="alert" data-pencil-name="Something Broke">
      <section className={CARD}>
        <div className="flex items-center gap-12">
          <span className={CHIP} aria-hidden>
            <Unplug size={18} />
          </span>
          <div>
            <h2 className="m-0 font-bold text-17/24 text-foreground">This screen stopped drawing</h2>
            <p className="m-0 text-12-5/normal text-muted-foreground">
              {where}. Nothing your Employees did was lost — this is the window, not the work.
            </p>
          </div>
        </div>
        <div className={BOX}>
          <p className={cx(MONO, 'text-12-5/normal text-foreground')}>{report.message}</p>
          <p className={cx(MONO, 'text-11-5/normal text-muted-foreground')}>{crashOrigin(report)}</p>
        </div>
        <div className="mt-16 flex gap-8">
          <Button icon={RefreshCw} onClick={onReload}>
            Reload this screen
          </Button>
          <Button variant="secondary" icon={ClipboardCopy} onClick={copy}>
            Copy report
          </Button>
        </div>
        {/* The fine print's ink has no token: it is the design's Slate 600. */}
        <p className="mt-24 mr-0 mb-0 ml-0 text-11-5/normal text-[#475569]">
          The report carries the message above, the screen you were on and the app&rsquo;s version — nothing from your
          repos. Send it to whoever gave you this build.
        </p>
      </section>
    </div>
  )
}

/*
 * Something Broke (frame `Y6xWi`), as utilities (T210f). The shell stays and only the content area
 * carries the error, so a crashed screen is one the boss can navigate away from — and the last
 * resort, with no content area to fill, takes the window it is standing in for.
 *
 * Pen strokes sit inside the box, so every bordered box here gives the 1px back from its padding.
 */
const SCREEN = 'flex min-h-0 flex-1 basis-0 items-center justify-center overflow-auto bg-background p-24'

const CARD =
  'flex w-560 max-w-full shrink-0 flex-col rounded-md border border-border bg-card px-23 pt-23 pb-15 font-sans leading-normal'

const CHIP =
  'flex h-36 w-36 shrink-0 items-center justify-center rounded-sm bg-status-error text-status-error-foreground'

const BOX = 'mt-15 flex flex-col gap-5 rounded-sm border border-border bg-muted px-12 py-11'

const MONO = 'm-0 font-code [overflow-wrap:anywhere]'
