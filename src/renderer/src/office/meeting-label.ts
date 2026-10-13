import type { Text } from 'pixi.js'
import type { Point } from '../../../shared/office/layout'
import { floorText } from './floor-text'

/**
 * The glass room's own label while a meeting is on (T94): `Meeting · 6`, the number of Employees the
 * exchange is for — the four the table seated and whoever it could not. It is the room counting
 * itself, not a warning about an overflow, so a meeting of four reads `Meeting · 4`.
 */
export function meetingLabel(count: number): string {
  return `Meeting · ${count}`
}

/** How far above the room's near edge the label hangs, in painting pixels. */
const LIFT = 6

/**
 * Where that label hangs: across the middle of the glass room's floor, just inside its near edge.
 * Every painted room draws its chairs down one side of the table, set back from that edge, so the
 * label sits under the sitters and never over them.
 */
export function meetingLabelSpot(area: Point[]): Point {
  const xs = area.map((p) => p.x)
  const x = (Math.min(...xs) + Math.max(...xs)) / 2
  return { x: Math.round(x), y: Math.round(nearEdge(area, x) - LIFT) }
}

/** The lowest point of the outline of `area` on the vertical line through `x`: the floor's near edge. */
function nearEdge(area: Point[], x: number): number {
  let bottom = -Infinity
  for (let i = 0; i < area.length; i++) {
    const a = area[i]!
    const b = area[(i + 1) % area.length]!
    if (a.x === b.x) continue
    const t = (x - a.x) / (b.x - a.x)
    if (t < 0 || t > 1) continue
    bottom = Math.max(bottom, a.y + t * (b.y - a.y))
  }
  return bottom
}

/** The label on the stage: one `Text` over the meeting room, shown only while a meeting is on. */
export interface MeetingLabelNode {
  /** Add this to the world; it is drawn over the room, like the boss's `Your chair`. */
  node: Text
  /** How many the meeting is for; 0 takes the label off the glass with the meeting. */
  set(count: number): void
}

export function createMeetingLabel(area: Point[]): MeetingLabelNode {
  const at = meetingLabelSpot(area)
  const node = floorText('', at.x, at.y)
  // Hung from its baseline on the near edge, so a longer count grows away from the sitters.
  node.anchor.set(0.5, 1)
  node.visible = false
  return {
    node,
    set(count) {
      node.visible = count > 0
      if (count > 0) node.text = meetingLabel(count)
    },
  }
}
