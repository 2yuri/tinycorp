import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { CharacterPortrait } from '../../sprites'
import '../tailwind.css'
import { accentFor } from './accent'
import { cx } from './cx'

/**
 * The tile's side in pixels. Chat and the Inbox draw 20 / 26 / 30 / 32 / 34, the other surfaces
 * 18 / 22 / 24 / 28 / 36 / 38 / 40; a size outside the scale would drift from the frames. 18 is
 * the smallest of them, in a Memory page's `updated` row (`E40vSb`), where the tile sits inside a
 * 19px line of chips.
 */
export type AvatarSize = 18 | 20 | 22 | 24 | 26 | 28 | 30 | 32 | 34 | 36 | 38 | 40

/** Tiles that are nobody's in particular: the boss, a Company, a `+N` rest. */
export type AvatarTone = 'primary' | 'success' | 'warning' | 'ink' | 'neutral'

/** Who the tile draws: an Employee's own character, on their own colour. */
export interface AvatarPerson {
  id: string
  /** Index of the Employee's character sheet, as `Employee.sprite` gives it. */
  sprite: number
}

/** Two-letter initials: first letters of the first two words, or the first two letters of one word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : words[0]![0]! + words[1]![0]!
  return letters.toUpperCase()
}

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string
  /** The tile's side in pixels; 40 by default. */
  size?: AvatarSize | undefined
  /** An Employee: the tile takes their accent and draws their pixel character. */
  person?: AvatarPerson | null | undefined
  /** The tile of someone who has no character — the boss, a Company. Ignored when `person` is given. */
  tone?: AvatarTone | undefined
  /** The 2px surface ring used on standalone and stacked avatars. */
  ring?: boolean | undefined
  /** Overrides the initials (for example "+4"), and what stands in until a character is decoded. */
  text?: string | undefined
  /**
   * A character sheet for someone who is not an Employee — the boss, whose sprite is their own
   * choice (T79). The tile keeps its tone; only the drawing comes from the sheet.
   */
  sprite?: number | undefined
}

/**
 * The tile. Its side is one number written on the element as `--ui-avatar-size`, and the three
 * utilities that read it are still utilities — which is what lets a caller pass `h-38 w-38` and
 * have `cx` drop the pair, the way the sheet's rule lost to those two classes before (T216). The
 * type is 36% of the side, as the frames draw it.
 */
const AVATAR =
  'relative inline-flex h-(--ui-avatar-size) w-(--ui-avatar-size) shrink-0 items-center justify-center overflow-hidden rounded-full font-sans font-bold text-[calc(var(--ui-avatar-size)*0.36)] leading-normal whitespace-nowrap select-none'

/** One tile per tone. An Employee's is `accent`, set per subtree by `data-accent`. */
const TONE: Record<AvatarTone | 'accent', string> = {
  accent: 'bg-accent-tile text-accent-soft',
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-status-success text-status-success-foreground',
  warning: 'bg-status-warning text-status-warning-foreground',
  ink: 'bg-brand-ink text-white',
  neutral: 'bg-secondary text-muted-foreground',
}

/**
 * The character this tile draws, cropped to the head: the standing frame is drawn 116% of the tile
 * and pulled back 8% on both axes, so the window lands between the hair and the chin, as the
 * design's `face-*` crops do — inside a tile that clips it. `CharacterPortrait` sets no size of its
 * own, so nothing here ties with it: every caller says how big its character is.
 */
const FACE = 'absolute top-[-8%] left-[-8%] h-auto w-[116%]'

/**
 * One avatar for every person in the app. An Employee renders their pixel character on a tile tinted
 * with their own accent; everyone else keeps initials. Until the character sheet is decoded the
 * initials stand in, so the tile never flashes empty.
 */
export function Avatar({
  name,
  size = 40,
  person,
  tone,
  ring = false,
  text,
  sprite,
  className,
  style,
  ...rest
}: AvatarProps) {
  const accent = person ? accentFor(person.id) : null
  const initials = text ?? initialsOf(name)
  const drawn = person ? person.sprite : sprite
  // Read out of the `cx` call: a bare `'accent'` inside one is a class list as far as
  // `tailwind.test.ts` is concerned, and a tone name is not a class.
  const toneClasses = TONE[accent ? 'accent' : (tone ?? 'neutral')]
  return (
    <span
      data-ui="Avatar"
      data-slot="avatar"
      role="img"
      aria-label={name}
      title={name}
      data-accent={accent ?? undefined}
      data-tone={accent ? 'accent' : (tone ?? 'neutral')}
      data-sprite={drawn}
      data-ring={ring || undefined}
      style={{ ...style, '--ui-avatar-size': `${size}px` } as CSSProperties}
      className={cx(AVATAR, toneClasses, ring && 'outline-2 outline-card', className)}
      {...rest}
    >
      {drawn !== undefined ? (
        <CharacterPortrait
          sprite={drawn}
          className={FACE}
          fallback={<span data-slot="avatar-initials">{initials}</span>}
        />
      ) : (
        initials
      )}
    </span>
  )
}

/**
 * Stacked avatars overlap by 10px, the way the design's `Members` frame does (gap: -10). What makes
 * the overlap read is each tile's 2px stroke in `--card`: without it the faces run into each other
 * and the first one's initials disappear under the second. It is drawn here rather than on every
 * avatar, because only a stacked one has a neighbour to separate from, and as a shadow rather than
 * a border, so it costs the tile no size.
 */
export function AvatarStack({ children }: { children: ReactNode }) {
  return (
    <span
      data-slot="avatar-stack"
      className="inline-flex items-center [&>[data-slot=avatar]+[data-slot=avatar]]:-ml-10 [&>[data-slot=avatar]]:shadow-[0_0_0_2px_var(--card)]"
    >
      {children}
    </span>
  )
}
