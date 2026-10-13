/**
 * Your profile's measurements (design/html/your-profile.html, Pen frame `Oykzs`), as class lists.
 *
 * They live in their own module because the page and the Providers card beside it draw the same
 * card — `profile.css` was one stylesheet both files imported, and this is that stylesheet (T210f).
 *
 * `#cbd5e1` is the design's Slate 300, the soft ink a chip, a toggle label and a link read, and
 * `#475569` its Slate 600, the stronger stroke whatever is chosen takes. The token set names
 * neither, so both are written where they draw.
 *
 * Every card is outlined with an inset ring rather than a border, as the design draws it: the 1px
 * lands inside the padding instead of pushing the content over.
 */

import { cx } from '../ui'

export const CARD = 'inset-ring-1 inset-ring-border flex w-full flex-col gap-14 rounded-md bg-card p-16'

/**
 * The right column's cards are drawn a shade tighter than the left's: 14px of padding against the
 * identity card's 16, measured off `Oykzs` — the Providers card's first box starts 14px in, and the
 * Notifications toggle ends 14px from the other edge.
 */
const SIDE_BOX = 'inset-ring-1 inset-ring-border flex w-full flex-col rounded-md bg-card p-14'

export const SIDE_CARD = cx(SIDE_BOX, 'gap-10')

/** The Companies sit closer than the column's other cards: a 36px row every 39px (`Oykzs`). */
export const COMPANIES_CARD = cx(SIDE_BOX, 'gap-3')

export const CARD_HEAD = 'flex flex-col gap-3'

/** A head whose title and line sit on one row, as `Your sprite` does. */
export const CARD_HEAD_INLINE = 'flex flex-row items-center gap-8'

export const CARD_TITLE = 'm-0 font-bold text-14/normal text-foreground'

export const CARD_TITLE_SMALL = 'm-0 font-bold text-13/normal text-foreground'

export const CARD_SUB = 'm-0 text-11-5 text-muted-foreground'

/** The soft ink, for the places that read it on their own. */
export const SOFT_INK = 'text-[#cbd5e1]'

/**
 * The identity fields are the frame's 34px controls, a size under the kit's 39px Input Group, and
 * the frame labels them in small caps rather than the kit's sentence case. `\_` for each BEM
 * underscore, because a bare `_` is how Tailwind writes a space.
 */
export const IDENTITY =
  '[&_[data-slot=field]]:gap-6 [&_[data-slot=field-control]]:p-[8px_11px] [&_[data-slot=field-control]:focus-within]:p-[7px_10px] [&_[data-slot=field][data-error]_[data-slot=field-control]:focus-within]:p-[8px_11px] [&_[data-slot=field-input]]:text-13-5/normal [&_[data-slot=field-label]]:font-bold [&_[data-slot=field-label]]:text-10-5/normal [&_[data-slot=field-label]]:text-muted-foreground [&_[data-slot=field-label]]:uppercase [&_[data-slot=field-label]]:tracking-[0.5px]'
