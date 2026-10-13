/**
 * The line people stand in at a coffee corner (T107).
 *
 * A room draws its corner as a run of floor: the boards in front of a counter, the rug in a lounge.
 * The corner has to hold everyone the room seats, because a usage limit or a Pause sends the whole
 * Company there at once — and ten Employees measured onto spots 24 px apart are drawn as one heap
 * with six heads, since a body is `CHARACTER_FOOTPRINT` painting pixels across.
 *
 * So a corner is measured as a path rather than as a pile: the line people stand in, from the head
 * at the counter along it and round whatever corner it turns. `coffeeQueue` walks that path and
 * drops a place every time it has come a whole body clear of everyone already standing in it, which
 * is exactly what `spotsClash` asks of two spots — a full footprint apart in x, in y, or in both.
 */
import { spotsClash } from './characters'
import type { Point, Spot } from './painted-room'

/** How finely the walk samples the path, in painting pixels: fine enough to stop right on the rule. */
const STEP = 1

/**
 * The first `count` places along `path`, no two of them reading as one person standing on another.
 * `path` is the queue's own line: its first vertex is the head, at the counter, and each vertex
 * carries the way whoever stands on the leg starting there faces.
 *
 * A path too short for `count` gives back the places it does hold rather than doubling anyone up;
 * `rooms.test.ts` holds every room to a path long enough for the Employees it seats.
 */
export function coffeeQueue(path: Spot[], count: number): Spot[] {
  const queue: Spot[] = []
  if (count < 1) return queue
  /** Takes the place unless someone already in the queue is standing there; true once it is full. */
  const take = (spot: Spot): boolean => {
    if (!queue.some((taken) => spotsClash(taken, spot))) queue.push(spot)
    return queue.length >= count
  }
  for (const [i, from] of path.entries()) {
    if (take({ x: Math.round(from.x), y: Math.round(from.y), facing: from.facing })) break
    const to = path[i + 1]
    if (!to) break
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    let full = false
    for (let along = STEP; along < length && !full; along += STEP) full = take(place(from, to, along, length))
    if (full) break
  }
  return queue
}

/** The place `along` px down the leg `from`→`to`, on whole painting pixels and facing the leg's way. */
function place(from: Spot, to: Point, along: number, length: number): Spot {
  return {
    x: Math.round(from.x + ((to.x - from.x) * along) / length),
    y: Math.round(from.y + ((to.y - from.y) * along) / length),
    facing: from.facing,
  }
}
