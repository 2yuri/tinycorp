import type { ReactNode } from 'react'
import { cx } from '../ui/kit/cx'
import { useCharacterLooks } from './character-looks'
import '../ui/tailwind.css'

/**
 * One pixel character standing, drawn from `office/characters.png` at runtime. The height comes from
 * the caller and is not defaulted here: the stylesheet gave it `height: 100%` and every caller
 * overrode that with a later rule of the same weight, which a utility cannot be overridden by at
 * all — the kit's face crop and the onboarding seat both lost their own height to it (T210f).
 *
 * The width follows the drawing, so every character keeps its own build. `image-rendering` and
 * `-webkit-user-drag` are arbitrary properties because Tailwind has no utility for either: a pixel
 * character that is smoothed stops being pixel art, and one that can be dragged out of the window
 * is a drawing the boss can lose.
 */
const PORTRAIT = 'block select-none [image-rendering:pixelated] [-webkit-user-drag:none]'

export function CharacterPortrait(props: {
  sprite: number
  className?: string
  /** Shown until the sheet is decoded, and if it never is — initials, say. */
  fallback?: ReactNode
}) {
  const looks = useCharacterLooks()
  const look = looks?.[((props.sprite % looks.length) + looks.length) % looks.length]
  const classes = cx(PORTRAIT, props.className)
  // Until the sheet is decoded the fallback stands in, or an empty slot keeps the space.
  if (!look?.src) return props.fallback === undefined ? <span className={classes} aria-hidden /> : <>{props.fallback}</>
  return <img className={classes} src={look.src} alt="" draggable={false} />
}
