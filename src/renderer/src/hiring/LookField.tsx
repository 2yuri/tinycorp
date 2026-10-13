import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { CharacterPortrait } from '../sprites'
import { cx } from '../ui'
import { rerollLook, stepLook } from './hire-model'
import '../ui/tailwind.css'
import { FIELD, LABEL } from './modal-fields'

/** How many characters still read as a row of dots under the tile; past that the count stands in. */
export const LOOK_DOTS_FIT = 8

/** The character the shuffle rolls: the tile's own reroll, so one press gives a new colleague. */
export function rollLook(sprite: number): number {
  return rerollLook(sprite, CHARACTER_SHEETS, Math.random())
}

/**
 * LOOK, the control the Hire Employee frame (`zf2Ks`) draws: the character standing on its floor,
 * an arrow each way around the sheets, and which of them it is. Hiring an Employee and editing one
 * draw this same component, so the next change to it reaches both.
 */
export function LookField(props: { value: number; onChange(sprite: number): void }) {
  const { value, onChange } = props
  return (
    <div data-ui="Look" className={cx(FIELD, LOOK)}>
      <span data-ui="Field Label" className={LABEL}>
        LOOK
      </span>
      <div className={TILE}>
        <span data-ui="Look Floor" className="absolute inset-x-0 top-80 bottom-0 bg-[#3b2a22]" aria-hidden />
        {/* The character stands on the floor strip, feet 21px above the tile's bottom. */}
        <CharacterPortrait sprite={value} className="absolute bottom-21 left-1/2 h-85 -translate-x-1/2" />
        <button
          type="button"
          className={cx(ARROW, 'left-6')}
          aria-label="Previous character"
          onClick={() => onChange(stepLook(value, -1, CHARACTER_SHEETS))}
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={cx(ARROW, 'right-6')}
          aria-label="Next character"
          onClick={() => onChange(stepLook(value, 1, CHARACTER_SHEETS))}
        >
          <ChevronRight size={14} aria-hidden />
        </button>
        {CHARACTER_SHEETS <= LOOK_DOTS_FIT ? (
          <span className={DOTS} aria-hidden>
            {Array.from({ length: CHARACTER_SHEETS }, (_, sheet) => (
              <span
                key={sheet}
                data-look={sheet}
                className={cx(DOT, sheet === value ? 'bg-foreground' : 'bg-brand-text-muted')}
              />
            ))}
          </span>
        ) : (
          // Past a handful of characters a dot each is unreadable; the count says the same thing.
          <span data-ui="Look Count" className={COUNT} aria-hidden>
            {value + 1} / {CHARACTER_SHEETS}
          </span>
        )}
      </div>
    </div>
  )
}

/*
 * The tile, as utilities (T210f). `#3b2a22` is the floor the character stands on: the frame's own
 * colour for a wooden strip, and no token names a floor.
 */
/*
 * The tile's own column, 132 wide beside NAME and MODEL. It goes on through `cx`, never a template
 * literal: `FIELD` is `w-full`, and two widths on one element are settled by the order Tailwind
 * emitted them in rather than by the order they are written. `w-full` won, so the LOOK column took
 * the whole row, the fields beside it were pushed past the modal's right edge, and focusing NAME
 * scrolled the body sideways to reach them (T224).
 */
const LOOK = 'w-132 shrink-0'

const TILE = 'relative h-112 w-132 overflow-hidden rounded-sm border border-border bg-card'

const ARROW =
  'absolute top-44 flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-0 bg-secondary p-0 text-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,var(--foreground)_12%)]'

const DOTS = 'absolute top-98 left-0 flex h-6 w-full items-center justify-center gap-4'

const DOT = 'h-4 w-4 rounded-full'

const COUNT = 'absolute top-94 left-0 w-full text-center font-semibold text-10-5/normal text-muted-foreground'
