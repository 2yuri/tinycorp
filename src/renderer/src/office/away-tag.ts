/**
 * Where the label that travels with a sprite is drawn, in the sprite's own space (T94, T100).
 *
 * It rides under the feet, which is where the floor writes everything else. A sprite standing at
 * the painting's own last line has no floor left under it: the boss chair in the Night Shift sits at
 * the frame's edge, and a visitor's label pressed flat against that edge landed on the same line as
 * `Your chair`. The frame is still the limit — nothing is drawn below it — but a label with no room
 * under it is flipped over the sprite instead, above the head, where the bubble already floats.
 */

/** How far under the sprite's feet the label rides while the floor has room for it. */
export const AWAY_TAG_DROP = 4

/** Clear air the floor keeps under its lowest label, in painting pixels: the line and a gutter. */
export const FLOOR_GUTTER = 10

/** Clear air between the label and whatever it is flipped over: the head, or the bubble above it. */
export const HEAD_GAP = 2

export interface AwayTagPlace {
  /** The sprite's feet, in painting pixels down the world: where its node stands. */
  feet: number
  /** The painting's own height: the last line the floor may write on. */
  floorBottom: number
  /** How tall the label is. */
  label: number
  /** How far over the feet the sprite's own top is: its head, or the bubble hanging over it. */
  headroom: number
}

/**
 * The label's `y` inside the sprite's node: positive under the feet, negative over the head.
 * The flip happens only when the whole label no longer fits above the painting's last line, so a
 * sprite anywhere else on the floor keeps the label exactly where T94 put it.
 */
export function awayTagY({ feet, floorBottom, label, headroom }: AwayTagPlace): number {
  if (feet + AWAY_TAG_DROP + label + FLOOR_GUTTER <= floorBottom) return AWAY_TAG_DROP
  return -headroom - HEAD_GAP - label
}
