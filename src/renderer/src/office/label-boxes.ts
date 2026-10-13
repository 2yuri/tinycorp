/**
 * The boxes the floor's labels want, before the layout pass moves any of them (T105).
 *
 * One place says where every label on the floor asks to sit — the name under a chair and the status
 * that travels with an Employee — so the stage and the tests read the same geometry. The stage
 * measures the boxes off its own `Text` nodes and asks where each sprite is standing this frame; a
 * test measures them from the font's own numbers and asks the projection.
 */
import type { Point, Seat } from '../../../shared/office/layout'
import type { OfficeSprite } from '../../../shared/office/projection'
import type { Box } from '../sprites'
import { awayTagY, HEAD_GAP } from './away-tag'
import type { FloorLabel } from './label-layout'
import { floorLabels } from './sprite-tag'

/** Clear air the floor keeps under its lowest label, in painting pixels: the line and a gutter. */
export const CHAIR_LABEL_MARGIN = 14

/** How far under a seat its name is written: past the painted chair it belongs to. */
const PAINTED_CHAIR_DROP = 16

/**
 * How far over a seat its name goes when the floor under it has run out and it is flipped: clear of
 * whoever is sitting there, as the away label clears its own head (T100).
 */
export const CHAIR_LABEL_RISE = 46

/**
 * Where a chair's own name sits: under the seat, in the aisle — but never off the painting, as the
 * boss's own chair does it (T95). A painted chair near the near edge would otherwise push its label
 * out of the frame.
 */
export function chairLabelSpot(seat: Seat, floorBottom = Infinity): Point {
  const under = seat.y + PAINTED_CHAIR_DROP
  return { x: seat.x, y: Math.min(under, floorBottom - CHAIR_LABEL_MARGIN) }
}

/** What the floor needs to know about one label it has not drawn yet. */
export interface LabelMetrics {
  width: number
  height: number
  /** How far over the feet the sprite's own top is: its head, or the bubble hanging over it. */
  headroom?: number
}

/** What the sprite half of the floor is: enough of a sprite to say what its labels are and where. */
export type FloorSprite = Pick<OfficeSprite, 'employeeId' | 'name' | 'reason' | 'away' | 'seat'>

export interface FloorLabelSources {
  /** Where the sprite is standing right now, in painting pixels: mid-walk on the stage, or its spot. */
  at(sprite: FloorSprite): Point
  /** The box this label's text takes, and the sprite's own headroom for the travelling one. */
  measure(key: string, text: string): LabelMetrics
  /**
   * The box the bubble over this sprite takes, in painting pixels, or null while it has none. A
   * label is never drawn across a bubble, its own or a neighbour's (T156).
   */
  bubble(sprite: FloorSprite): Box | null
}

/** The key the chair's own name is laid out under; stable for as long as the Employee is in the room. */
export const chairKey = (employeeId: string): string => `chair:${employeeId}`
/** The key the travelling label is laid out under. */
export const awayKey = (employeeId: string): string => `away:${employeeId}`
/** The key the bubble over a sprite is laid out under: a fixed box the labels move around. */
export const bubbleKey = (employeeId: string): string => `bubble:${employeeId}`

/** A bubble as the layout pass takes it: a fixed box, like the room's own lines (T156). */
export function bubbleObstacle(key: string, box: Box): FloorLabel {
  return { key, x: box.x + box.w / 2, y: box.y, width: box.w, height: box.h, fixed: true }
}

/**
 * Every label the people on the floor put there, each with the box it asks for, and every bubble
 * over their heads as a fixed box the labels move around (T156). The room's own lines — `Your
 * chair`, `Meeting · N`, `At the counter · N` — are added by whoever holds them, fixed the same way.
 */
export function floorLabelBoxes(
  sprites: readonly FloorSprite[],
  painting: { height: number },
  sources: FloorLabelSources,
): FloorLabel[] {
  const boxes: FloorLabel[] = []
  for (const sprite of sprites) {
    const bubble = sources.bubble(sprite)
    if (bubble) boxes.push(bubbleObstacle(bubbleKey(sprite.employeeId), bubble))
    const labels = floorLabels(sprite)
    if (labels.chair !== null && sprite.seat) {
      const key = chairKey(sprite.employeeId)
      const { width, height } = sources.measure(key, labels.chair)
      const at = chairLabelSpot(sprite.seat, painting.height)
      boxes.push({
        key,
        x: at.x,
        y: at.y,
        width,
        height,
        above: sprite.seat.y - CHAIR_LABEL_RISE - height,
      })
    }
    if (labels.away !== null) {
      const key = awayKey(sprite.employeeId)
      const { width, height, headroom = 0 } = sources.measure(key, labels.away)
      const feet = sources.at(sprite).y
      // Where T100 already puts it: under the feet, or flipped over the head at the painting's edge.
      const y = feet + awayTagY({ feet, floorBottom: painting.height, label: height, headroom })
      boxes.push({
        key,
        x: sources.at(sprite).x,
        y,
        width,
        height,
        over: y < feet,
        above: feet - headroom - HEAD_GAP - height,
      })
    }
  }
  return boxes
}
