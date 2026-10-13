import { Armchair, Check, Coffee, Presentation } from 'lucide-react'
import { useId } from 'react'
import { isSelectable, type OfficeRoom, ROOMS, type RoomSlug, roomDesks, roomOf } from '../../../shared/office/rooms'
import { CHOICE_INPUT, cx } from '../ui'
import '../ui/tailwind.css'

/*
 * Company settings › Office (design/html/company-settings-office.html: frame `V0brJM`). The chips
 * over the painting and the swatch hairline are `--canvas-*`, added to `ui/tokens.css` by this
 * ticket: they were four translucent hexes written into this stylesheet.
 */
const TAB = 'flex min-w-0 flex-[1_1_100%] flex-col gap-16 px-24 pt-20 pb-24'

/*
 * The painting, 480px tall in the frame, shown whole rather than cropped to the panel: the tab is
 * about the room, and `cover` cuts the desks off a painting narrower than the panel. The frame's
 * stroke is drawn on top, so the art is fitted to the whole box.
 */
const PREVIEW =
  'relative h-480 shrink-0 overflow-hidden rounded-md border border-border bg-background bg-contain bg-origin-border bg-center bg-no-repeat'

const CHIPS = 'absolute bottom-14 left-14 flex items-center gap-8'

/** A chip and the one saying which room is in use: two exclusive lists, both set a tint and an ink. */
const CHIP =
  'flex items-center gap-6 rounded-full border border-canvas-edge bg-canvas-chip px-11 py-6 text-11-5/[inherit] font-medium whitespace-nowrap text-muted-foreground [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const CHIP_CURRENT =
  'flex items-center gap-6 rounded-full border border-canvas-edge bg-canvas-chip-strong px-11 py-6 text-11-5/[inherit] font-bold whitespace-nowrap text-foreground [&_svg]:shrink-0 [&_svg]:text-canvas-foreground'

/** The frame's 13/16 is measured from the strip's outer edge, so the stroke comes out of it. */
const DETAIL = 'flex shrink-0 items-center gap-24 rounded-md border border-border bg-card px-15 py-12'
const NAME = 'flex w-250 shrink-0 flex-col gap-3'
const TITLE = 'm-0 text-14/[inherit] font-bold text-foreground'
const DESC = 'm-0 text-11-5/16 text-muted-foreground'
const META = 'm-0 flex min-w-0 flex-[1_1_0] items-center gap-28'
const FACT = 'flex flex-col gap-3'

/** `V0brJM` draws its fact labels in an 11px box, not the 12 the scale pairs with 9.5. */
export const FACT_LABEL = 'text-9-5/11 font-bold tracking-[1px] whitespace-nowrap uppercase text-muted-foreground'
const FACT_VALUE = 'm-0 text-12-5/[inherit] whitespace-nowrap text-canvas-foreground'

const PALETTE = 'flex shrink-0 items-center gap-6'
const SWATCH = 'size-20 rounded-[5px] border border-canvas-edge-soft'

/** The thumbnails, one row, equal widths. */
const OPTIONS = 'flex shrink-0 gap-12'

/** A `<label>`, so there is no UA padding or border to hold back — only the cursor is set. */
const OPTION = 'group flex flex-[1_1_0] cursor-pointer flex-col gap-7 text-left'
const OPTION_SOON = 'group flex flex-[1_1_0] cursor-default flex-col gap-7 text-left'

/**
 * The thumbnail. Picked draws a 2px edge where the rest draw 1, so the two are exclusive lists;
 * `box-sizing: border-box` is `ui/tailwind.css`'s, so the extra pixel comes out of the box.
 */
const ART_BASE =
  'relative block h-112 overflow-hidden rounded-sm bg-card bg-cover bg-origin-border bg-center bg-no-repeat group-has-[>[data-slot=choice-input]:focus-visible]:outline-2 group-has-[>[data-slot=choice-input]:focus-visible]:outline-offset-2 group-has-[>[data-slot=choice-input]:focus-visible]:outline-ring'
export const ART_PICKED = 'border-2 border-canvas-foreground'
const ART_PICKABLE = 'border border-border group-hover:border-muted-foreground'
const ART_SOON = 'border border-border opacity-45'

const CHECK =
  'absolute top-8 left-8 flex size-20 items-center justify-center rounded-full bg-foreground text-background'
const SOON =
  'absolute bottom-8 left-8 rounded-full border border-canvas-edge bg-canvas-chip-strong px-8 py-3 text-10/[inherit] font-semibold whitespace-nowrap text-muted-foreground'

const CAPTION = 'text-12/[inherit] font-medium text-canvas-foreground'
const CAPTION_PICKED = 'text-12/[inherit] font-bold text-foreground'

const NOTE = 'm-0 text-11-5/[inherit] text-muted-foreground'

/** What the note under the thumbnails tells the boss about switching (frame V0brJM). */
export function switchNote(companyName: string): string {
  return `Everyone in ${companyName} sees this room. It swaps on their next office load — Sessions keep running.`
}

/** What the page says under its title while the Office tab is open. */
export function officeTabSubtitle(companyName: string): string {
  return `The room every Employee in ${companyName} works in — and the desks they sit at.`
}

export interface OfficeTabProps {
  companyName: string
  /** The room the draft picks; Save changes sends it. */
  slug: RoomSlug
  /** The room the Company works in now, which wears the `In use now` chip. */
  savedSlug: RoomSlug
  onPick(slug: RoomSlug): void
}

/**
 * Company settings › Office (design/html/company-settings-office.html): the room every Employee
 * works in. The preview, what the room is, and the rooms to pick from — only the ones whose
 * geometry has been measured can be chosen (T84, T85 bring the rest).
 */
export function OfficeTab({ companyName, slug, savedSlug, onPick }: OfficeTabProps) {
  const room = roomOf(slug)
  const name = useId()
  return (
    <div className={TAB}>
      <Preview room={room} inUse={room.slug === savedSlug} />
      <RoomDetail room={room} />
      <div className={OPTIONS} role="radiogroup" aria-label="Room">
        {ROOMS.map((option) => (
          <RoomOption
            key={option.slug}
            room={option}
            picked={option.slug === slug}
            name={name}
            onPick={() => onPick(option.slug)}
          />
        ))}
      </div>
      <p className={NOTE}>{switchNote(companyName)}</p>
    </div>
  )
}

/** The big painting, with what the room has over its bottom-left corner. */
function Preview({ room, inUse }: { room: OfficeRoom; inUse: boolean }) {
  const desks = isSelectable(room) ? roomDesks(room.geometry).total : null
  return (
    <div className={PREVIEW} style={{ backgroundImage: `url(./${room.art})` }} role="img" aria-label={room.name}>
      <div className={CHIPS}>
        {inUse && (
          <span className={CHIP_CURRENT}>
            <Check size={12} aria-hidden /> In use now
          </span>
        )}
        {desks !== null && (
          <span className={CHIP}>
            <Armchair size={12} aria-hidden /> {desks} desks
          </span>
        )}
        {(room.geometry?.meeting.spots.length ?? 0) > 0 && (
          <span className={CHIP}>
            <Presentation size={12} aria-hidden /> Meeting room
          </span>
        )}
        {(room.geometry?.coffee.spots.length ?? 0) > 0 && (
          <span className={CHIP}>
            <Coffee size={12} aria-hidden /> Coffee area
          </span>
        )}
      </div>
    </div>
  )
}

/** The bar under the preview: what the room is called, what it is like, its facts and its palette. */
function RoomDetail({ room }: { room: OfficeRoom }) {
  return (
    <div className={DETAIL}>
      <div className={NAME}>
        <h2 className={TITLE}>{room.name}</h2>
        <p className={DESC}>{room.description}</p>
      </div>
      <dl className={META}>
        <Fact label="Desks" value={room.facts?.desks} />
        <Fact label="Rooms" value={room.facts?.rooms} />
        <Fact label="Light mode" value={room.facts?.lightMode} />
        <Fact label="Floor space" value={room.facts?.floorSpace} />
      </dl>
      <div className={PALETTE} aria-hidden>
        {room.palette.map((swatch) => (
          <span key={swatch} className={SWATCH} style={{ background: swatch }} />
        ))}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string | undefined }) {
  return (
    <div className={FACT}>
      <dt className={FACT_LABEL}>{label}</dt>
      <dd className={FACT_VALUE}>{value ?? '—'}</dd>
    </div>
  )
}

/** One thumbnail. A room with no geometry cannot be chosen and says so. */
function RoomOption({
  room,
  picked,
  name,
  onPick,
}: {
  room: OfficeRoom
  picked: boolean
  /** The radio group these thumbnails are one of. */
  name: string
  onPick(): void
}) {
  const selectable = isSelectable(room)
  return (
    <label className={selectable ? OPTION : OPTION_SOON}>
      <input
        type="radio"
        data-slot="choice-input"
        className={CHOICE_INPUT}
        name={name}
        disabled={!selectable}
        checked={picked}
        onChange={onPick}
      />
      <span
        className={cx(ART_BASE, picked ? ART_PICKED : selectable ? ART_PICKABLE : ART_SOON)}
        style={{ backgroundImage: `url(./${room.art})` }}
      >
        {picked && (
          <span className={CHECK} aria-hidden>
            <Check size={12} />
          </span>
        )}
        {!selectable && <span className={SOON}>Coming soon</span>}
      </span>
      <span className={picked ? CAPTION_PICKED : CAPTION}>{room.name}</span>
    </label>
  )
}
