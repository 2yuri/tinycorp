/**
 * No two labels the floor draws sit on top of each other (T105).
 *
 * T100 quietened the crowded *places*: the counter and the meeting table speak for the group, and
 * nobody standing in them carries a label. This is the other half — two desks a sprite apart on an
 * ordinary floor, whose labels land on the same line and print `Bo · Attaking`, a word that does not
 * exist. Before the floor draws them, the labels are laid out: each knows its own box, and where two
 * boxes overlap the lower one is moved down a line, and the next, until it is clear. The floor has
 * room under a desk and the labels are small.
 *
 * A label with no floor left under it is flipped over its own sprite instead, as the boss desk's
 * visitor already does (T100), and climbs from there. The pass is stable: labels are settled in a
 * fixed order — the room's own lines first, then top to bottom — so the same floor lays out the same
 * way twice and a sprite that has not moved does not have its label jump.
 *
 * A bubble over a head is on the floor too, and a label drawn across one reads as a word that does
 * not exist just the same — `Bo · Idlez` (T156). Bubbles come in as fixed boxes, like the room's own
 * lines: they belong to a head and do not move, so the labels move around them.
 */

/** Clear air the floor keeps between two labels it had to stack, in painting pixels. */
export const LABEL_GUTTER = 2

/** One label's box on the floor, before it is laid out. */
export interface FloorLabel {
  /** Stable identity, so the same label settles the same way frame after frame. */
  key: string
  /** The middle of the label: the floor centres its text on its spot. */
  x: number
  /** The top of the label where it wants to sit, in painting pixels down the world. */
  y: number
  width: number
  height: number
  /**
   * The top the label takes when the floor under it runs out and it is flipped over its own sprite.
   * Absent for a label with nowhere to flip to, which simply stays on the last line that held it.
   */
  above?: number
  /** True where `y` is already over the sprite: a flipped label climbs when it is pushed, not falls. */
  over?: boolean
  /** True for a line painted with the room rather than with a person: the others move around it. */
  fixed?: boolean
}

export interface PlacedLabel extends FloorLabel {
  /** True where the label ended up over its sprite instead of under it. */
  flipped: boolean
}

export interface FloorRoom {
  /** The lowest line a label's bottom may reach: the painting's own edge, less its gutter. */
  bottom: number
}

/**
 * The labels with none of them overlapping, in the order they were given, so a caller can hand each
 * one back to the node it came from.
 */
export function layOutLabels(labels: readonly FloorLabel[], { bottom }: FloorRoom): PlacedLabel[] {
  const settled: PlacedLabel[] = []
  const placed = new Array<PlacedLabel>(labels.length)
  for (const index of order(labels)) {
    const at = settle(labels[index]!, settled, bottom)
    settled.push(at)
    placed[index] = at
  }
  return placed
}

/** The order the labels are settled in: the room's own lines, then top to bottom, then left to right. */
function order(labels: readonly FloorLabel[]): number[] {
  return labels
    .map((_, index) => index)
    .sort((a, b) => {
      const one = labels[a]!
      const two = labels[b]!
      return (
        Number(two.fixed ?? false) - Number(one.fixed ?? false) ||
        one.y - two.y ||
        one.x - two.x ||
        (one.key < two.key ? -1 : one.key > two.key ? 1 : 0)
      )
    })
}

function settle(label: FloorLabel, settled: readonly PlacedLabel[], bottom: number): PlacedLabel {
  if (label.fixed) return { ...label, flipped: false }
  if (label.over) return { ...label, y: climb(label, label.y, settled), flipped: true }
  const line = label.height + LABEL_GUTTER
  let y = label.y
  while (hits(label, y, settled)) {
    const next = y + line
    // Past the painting's edge: over the sprite instead, or the last line that held it.
    if (next + label.height > bottom) {
      if (label.above === undefined) return { ...label, y, flipped: false }
      return { ...label, y: climb(label, label.above, settled), flipped: true }
    }
    y = next
  }
  return { ...label, y, flipped: false }
}

/** A flipped label rises until it is clear, and never off the top of the painting. */
function climb(label: FloorLabel, from: number, settled: readonly PlacedLabel[]): number {
  const line = label.height + LABEL_GUTTER
  let y = from
  while (hits(label, y, settled) && y - line >= 0) y -= line
  return y
}

function hits(label: FloorLabel, y: number, settled: readonly PlacedLabel[]): boolean {
  return settled.some((other) => overlaps({ ...label, y }, other))
}

function overlaps(a: FloorLabel, b: FloorLabel): boolean {
  return (
    a.x - a.width / 2 < b.x + b.width / 2 &&
    b.x - b.width / 2 < a.x + a.width / 2 &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

/** True where two laid-out boxes share a pixel: what the floor must never draw. */
export function labelsOverlap(a: FloorLabel, b: FloorLabel): boolean {
  return overlaps(a, b)
}
