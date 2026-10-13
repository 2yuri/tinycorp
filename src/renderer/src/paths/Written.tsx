import { FolderOpen } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { type PathLink, pathMentions, pathSegments, pathTitle } from '../../../shared/files/path-links'
import { machineWordsHere } from '../chrome'
import { Alert } from '../ui'
import { desktopPathOpenDeps, openPathLink, revealPath } from './path-open'
import '../ui/tailwind.css'

/**
 * A piece of text an Employee or the boss wrote, with every path in it drawn as a link (T114).
 * `plain` draws what is left — the `#12`s and the `@names` the surrounding view already knew how to
 * draw — so a path link composes with them instead of replacing them.
 */
export function Written({ text, plain }: { text: string; plain?: (part: string, key: number) => ReactNode }) {
  return <WrittenText text={text} links={usePathLinks(text)} plain={plain} />
}

/**
 * The same text with the links already found: what the view actually draws. Every path opens in
 * the Files view, as a tab (T121); only a Reveal that fails has anything to say here.
 */
export function WrittenText({
  text,
  links,
  plain,
}: {
  text: string
  links: readonly PathLink[]
  plain?: ((part: string, key: number) => ReactNode) | undefined
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {pathSegments(text, links).map((segment, index) =>
        segment.link ? (
          <PathLinkText key={index} link={segment.link} onError={setError} />
        ) : plain ? (
          plain(segment.text, index)
        ) : (
          // Bare text, not a span of its own: a view's own markup is left exactly as it was.
          segment.text
        ),
      )}
      {error &&
        createPortal(
          <div className="fixed right-16 bottom-16 z-60 w-380 font-sans">
            <Alert variant="error" title={error} onClose={() => setError(null)} />
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * The link over a path, and the Reveal button beside it.
 *
 * `all: unset` is not translated as `[all:unset]`: Tailwind emits an arbitrary property **last**, so
 * it would wipe every other utility on the element — the colour, the font, the cursor, all of it.
 * What it actually did to a `<button>` is written out instead, and `ui/tailwind.css` already gives one
 * `font: inherit` and `color: inherit`.
 *
 * `text-[0.9em]` stays a raw value because it is the one size in these six folders that is relative:
 * the link sits in running prose — a chat message, an Activity line, the Inbox — and is nine tenths
 * of whatever that line is set in. The type scale is in pixels and cannot say that.
 *
 * `path-link` and `path-link__reveal` are in the lists because `Written.test.tsx` reads both: one
 * for the markup a path turns into, the other to assert a path inside the Company draws no Reveal.
 * Deleting the second would make that assertion pass for the wrong reason, which is worse than
 * keeping the name.
 */
const LINK =
  'path-link m-0 inline cursor-pointer appearance-none whitespace-normal border-0 bg-transparent p-0 font-code text-[0.9em] text-status-info-foreground [text-align:inherit] hover:underline focus-visible:rounded-xs focus-visible:shadow-focus data-[outside=true]:underline data-[outside=true]:decoration-dotted data-[outside=true]:underline-offset-2'

const REVEAL =
  'path-link__reveal m-0 ml-3 inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0 align-baseline text-muted-foreground [text-align:inherit] hover:text-status-info-foreground focus-visible:rounded-xs focus-visible:shadow-focus'

/**
 * One path, as a link. The whole path is on the hover, so the boss sees what a click opens before
 * clicking it; a path from outside the Company offers Reveal in Finder beside it.
 */
export function PathLinkText({ link, onError }: { link: PathLink; onError(message: string): void }) {
  return (
    <span className="whitespace-nowrap">
      <button
        type="button"
        className={LINK}
        title={pathTitle(link)}
        data-outside={link.target.kind === 'outside' ? 'true' : undefined}
        onClick={() => openPathLink(link, desktopPathOpenDeps)}
      >
        {link.text}
      </button>
      {link.target.kind === 'outside' && (
        <button
          type="button"
          className={REVEAL}
          title={machineWordsHere().reveal}
          aria-label={`Reveal ${link.full} in ${machineWordsHere().fileManager}`}
          onClick={() => void revealPath(link, onError)}
        >
          <FolderOpen size={12} aria-hidden />
        </button>
      )}
    </span>
  )
}

/** What the main process already answered for a piece of text, so a redraw asks nothing twice. */
const answered = new Map<string, PathLink[]>()
/**
 * What it has been asked and has not answered yet, so two components drawing the same text ask
 * once between them: a chat message draws its words and its pictures from the same links (T236),
 * and both mount in the same tick, before either has an answer to remember.
 */
const asking = new Map<string, Promise<PathLink[]>>()
/** How many texts the answers are kept for; a long channel drops the oldest. */
const REMEMBERED = 400
const NONE: PathLink[] = []
/** Installed once: another Company has other places, so nothing answered here holds there. */
let _forgetting: (() => void) | null = null

/**
 * The links in a piece of text, from the main process — the only place that may look on disk.
 * The answer is remembered for the text, and a text drawn again asks nothing; a file written after
 * a message was drawn becomes a link the next time the view is.
 */
export function usePathLinks(text: string): PathLink[] {
  const [links, setLinks] = useState<PathLink[]>(() => answered.get(text) ?? NONE)

  useEffect(() => {
    const api = window.tinyCorp?.paths
    // Text with nothing that could even be a path is never asked about: most of it is not.
    if (!api || pathMentions(text).length === 0) return
    forget()
    const known = answered.get(text)
    if (known) {
      setLinks(known)
      return
    }
    let pending = asking.get(text)
    if (!pending) {
      pending = api.links(text).then((result) => {
        const found = result.ok ? result.value : NONE
        remember(text, found)
        asking.delete(text)
        return found
      })
      asking.set(text, pending)
    }
    let live = true
    void pending.then((found) => {
      if (live) setLinks(found)
    })
    return () => {
      live = false
    }
  }, [text])

  return links
}

function remember(text: string, links: PathLink[]): void {
  if (answered.size >= REMEMBERED) answered.delete(answered.keys().next().value!)
  answered.set(text, links)
}

/** Forgets every answer when the boss switches Company, since the places are another Company's. */
function forget(): void {
  _forgetting ??=
    window.tinyCorp?.company?.onChanged(() => {
      answered.clear()
      asking.clear()
    }) ?? null
}
