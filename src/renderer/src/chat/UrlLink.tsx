import { Copy, ExternalLink } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { createPortal } from 'react-dom'
import { machineWordsHere } from '../chrome'
import { DropdownMenu, MenuItem, useDismiss } from '../ui'
import '../ui/tailwind.css'

/** A web link in running prose: the info ink of a path link, at nine tenths of the line it sits in. */
const LINK =
  'm-0 inline cursor-pointer appearance-none whitespace-normal border-0 bg-transparent p-0 text-status-info-foreground underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere] [text-align:inherit] hover:decoration-solid focus-visible:rounded-xs focus-visible:shadow-focus'

/** Opens `url` in the system browser: the window hands every `http(s)` it is asked to open there. */
export function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener')
}

/** True when a click asks to open the link straight away: ⌘ on a Mac, Ctrl everywhere else. */
export function opensStraightAway(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}

/**
 * A link an Employee or the boss wrote (T290). A click asks what to do with it — open it or copy
 * it — because a link in an agent's message is as often wanted on the clipboard as in a browser;
 * a click with the modifier held opens it at once, the way every editor does.
 */
export function UrlLink({ url }: { url: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const close = () => setAt(null)
  const { popover, trigger } = useDismiss<HTMLDivElement, HTMLButtonElement>(at !== null, close)
  const modifier = machineWordsHere().modifier
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={LINK}
        title={`${url}\n${modifier}-click to open`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(event) => {
          if (opensStraightAway(event)) {
            openUrl(url)
            return
          }
          const box = event.currentTarget.getBoundingClientRect()
          setAt(at ? null : { left: box.left, top: box.bottom + 4 })
        }}
      >
        {url}
      </button>
      {at &&
        createPortal(
          <div ref={popover} className="fixed z-50 min-w-200 font-sans" style={{ left: at.left, top: at.top }}>
            <DropdownMenu aria-label="Link">
              <MenuItem
                icon={ExternalLink}
                label="Open link"
                shortcut={`${modifier}-click`}
                onClick={() => {
                  close()
                  openUrl(url)
                }}
              />
              <MenuItem
                icon={Copy}
                label="Copy link"
                onClick={() => {
                  close()
                  void navigator.clipboard?.writeText(url)
                }}
              />
            </DropdownMenu>
          </div>,
          document.body,
        )}
    </>
  )
}
