import type { Text } from 'pixi.js'
import type { Point } from '../../../shared/office/layout'
import { floorText } from './floor-text'

/** How far under the nearest stander's feet the corner's line is written, in painting pixels. */
const DROP = 6

/** Clear air the floor keeps under its lowest label: the line and a gutter. */
const MARGIN = 14

/**
 * Where the counter's own label sits (T100): across the middle of the queue, under the feet of
 * whoever stands nearest the viewer, so it reads as one line for the group and never over a head.
 * The painting's last line is the limit, as it is for `Your chair`.
 */
export function counterLabelSpot(spots: Point[], floorBottom = Infinity): Point {
  const xs = spots.map((spot) => spot.x)
  const front = Math.max(...spots.map((spot) => spot.y))
  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round(Math.min(front + DROP, floorBottom - MARGIN)),
  }
}

/** The label on the stage: one `Text` over the coffee corner, shown only while someone is at it. */
export interface CounterLabelNode {
  /** Add this to the world; it is drawn over the room, like the glass room's own count. */
  node: Text
  /** What the corner says and who is standing there; no spots takes the label off the floor. */
  set(label: string | null, spots: Point[], floorBottom?: number): void
}

export function createCounterLabel(): CounterLabelNode {
  const node = floorText('', 0, 0)
  node.visible = false
  return {
    node,
    set(label, spots, floorBottom) {
      node.visible = label !== null && spots.length > 0
      if (!node.visible) return
      node.text = label as string
      const at = counterLabelSpot(spots, floorBottom)
      node.position.set(at.x, at.y)
    },
  }
}
