import { Graphics } from 'pixi.js'

/**
 * The soft patch of floor under a character. The paintings light every room from above, and their own
 * furniture is painted with a shadow under it, so a sprite drawn with none reads as floating a
 * pixel over the boards. This is that shadow: an ellipse at the feet, under the body and over the
 * floor, dark and soft enough to sit in any of the rooms without becoming a hole.
 */
export const SHADOW = {
  /** Across, in painting pixels: a little wider than a body, so it reads as under them and not as a mat. */
  width: 26,
  /** And front to back, at the 2:1 angle the rooms are drawn in. */
  height: 11,
  colour: 0x0a0a12,
  alpha: 0.28,
} as const

/** The ellipse itself, centred on the sprite's own origin, which is the floor it stands on. */
export function createShadow(): Graphics {
  return new Graphics()
    .ellipse(0, 0, SHADOW.width / 2, SHADOW.height / 2)
    .fill({ color: SHADOW.colour, alpha: SHADOW.alpha })
}
