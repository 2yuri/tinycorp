/**
 * The air a speech bubble takes on the floor, so no label is drawn across one (T156).
 *
 * A bubble hangs over a head, and the head of a sitter one desk down the room is level with the
 * chair label of the desk above it: Night Studio with everyone Idle drew Flo's `Zzz` over the end of
 * `Bo · Idle`, which read `Bo · Idlez`. The layout pass (T105) keeps labels off each other; this is
 * the box it keeps them off a bubble with, which it treats like the room's own lines — fixed, and
 * the labels move around it.
 */
import type { Point } from '../../../shared/office/layout'
import type { Box } from '../sprites'

/**
 * Painting pixels per sheet pixel for the marker sheet's bubbles: the sheet paints one 285 px across,
 * and over a head it reads at the 28 the hand-drawn box did.
 */
export const BUBBLE_SCALE = 0.1

/** Clear air between the top of the head and the tip of the bubble's tail, in painting pixels. */
export const BUBBLE_LIFT = 2

/**
 * How far a bubble drifts either way of where it hangs: its own bob, and a typing sitter's nod under
 * it. The box covers the whole drift, so a label is laid out once for it rather than every frame.
 */
export const BUBBLE_SWAY = 2

/** A bubble's drawing, in the marker sheet's own pixels: the rounded box and the tip of its tail. */
export interface BubbleShape {
  body: Box
  tip: Point
}

/**
 * The box a bubble takes in painting pixels, its tail's tip hung at `tip`: from the top of the
 * rounded box to the tip, as wide as the box, and `sway` taller each way for the bob.
 */
export function bubbleBox(shape: BubbleShape, tip: Point, sway = BUBBLE_SWAY): Box {
  const left = (shape.body.x - shape.tip.x) * BUBBLE_SCALE
  const top = (shape.body.y - shape.tip.y) * BUBBLE_SCALE
  return {
    x: tip.x + left,
    y: tip.y + top - sway,
    w: shape.body.w * BUBBLE_SCALE,
    h: -top + 2 * sway,
  }
}

/** Where the tail's tip hangs over a sprite standing at `feet`, whose body is `bodyHeight` tall. */
export function bubbleTip(feet: Point, bodyHeight: number): Point {
  return { x: feet.x, y: feet.y - bodyHeight - BUBBLE_LIFT }
}
