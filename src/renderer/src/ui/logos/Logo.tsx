import { cx } from '../kit'
import { logoUrl } from './logo-assets'
import '../tailwind.css'

/**
 * A logo belonging to somebody else, drawn as the file it was vendored as.
 *
 * `ProviderMark` and `PresetMark` are what a screen reaches for; this is the drawing under both of
 * them, and the only place in the app that an `<img>` of a vendored logo is written.
 *
 * **Everything it may do to a mark is here, and it is almost nothing.** `docs/brand-logos.md` is
 * why: a logo identifies the service an integration connects to, so it is drawn unmodified —
 * never recoloured beyond the two variants its own set publishes, never cropped, never stretched
 * to a box it was not drawn for, and never inlined into the markup where a stylesheet could reach
 * it.
 */

/** What every mark takes, and what the lucide marks they fall back to already took. */
export interface MarkProps {
  /** The mark's box, in pixels. */
  size?: number
  className?: string | undefined
}

/**
 * **Which files are the set's colour variant**: LobeHub publishes a mark twice, `name.svg` in one
 * colour and `name-color.svg` as its owner draws it, and the file keeps the name it was published
 * under. Simple Icons publishes one monochrome mark and no colour variant at all, so a file with
 * no suffix is monochrome whichever set it came from. This is the whole of what {@link mono} has
 * to decide, and `logos.test.ts` reads the files back to say the two sets really are that.
 */
const COLOUR_SUFFIX = '-color'

/**
 * Whether a vendored file is the monochrome mark rather than the colour one.
 *
 * It matters because **this app's own theme is dark by default** (`ui/tokens.css`: `:root` is the
 * Dark palette and `[data-theme='light']` is the override). A monochrome mark is published black —
 * LobeHub's takes `currentColor`, which in an `<img>` is black, and Simple Icons' is black outright
 * — so drawn as it comes it is a black glyph on a slate card, which is no mark at all.
 */
function mono(name: string): boolean {
  return !name.endsWith(COLOUR_SUFFIX)
}

/**
 * One vendored logo, at `size` square.
 *
 * It is `aria-hidden` with an empty `alt` on purpose: every place the app draws one, the service's
 * own name is the text beside it, and a screen reader that read both would say it twice.
 *
 * `object-contain` because the two sets draw on different canvases — one squares its marks at
 * 24×24, the other leaves a wordless glyph its own proportions — and a logo may not be stretched
 * to a box it was not drawn for.
 *
 * **A monochrome mark is inverted under the dark theme and only there**, which turns the black it
 * was published in into white — the same mark, in the other of the two colours a monochrome mark
 * is for, and what `currentColor` would have produced if an `<img>` could see the page's colour.
 * A colour mark is never filtered: it is drawn exactly as its owner draws it, whatever it is
 * sitting on. See `docs/brand-logos.md`.
 */
export function Logo({ name, size = 16, className }: { name: string } & MarkProps) {
  const src = logoUrl(name)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cx(
        'block shrink-0 object-contain',
        mono(name) && "invert [[data-theme='light']_&]:invert-0",
        className,
      )}
    />
  )
}
