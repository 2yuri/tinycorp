/**
 * The sliding doors in the painted walls, as pure state: who is near a door decides whether it is open,
 * and how far it has slid follows from the time since the last frame. The office view keeps the states it
 * gets back and hands them in again next frame; it only draws what is here.
 */
import { PAINTED_ROOM, type PaintedWall, type Point } from './painted-room'

/** How close to the door gap a character has to be for the door to open, in painting pixels. */
export const DOOR_REACH = 40
/** How long the door stays open after the last character left its reach. */
export const DOOR_CLOSE_MS = 400
/** How long a full slide takes, open or shut. */
export const DOOR_SLIDE_MS = 240

/** How far one door has slid, and since when. */
export interface DoorOpening {
  /** 0 shut, 1 fully open, as it was at `at`. */
  open: number
  /** Epoch ms `open` was measured. */
  at: number
  /** Epoch ms the last character left the door's reach; null while someone is still within it. */
  freeSince: number | null
}

/** The doors of the office, by wall name. */
export type DoorStates = Record<string, DoorOpening>

/** Whoever the doors react to: a character's feet. */
export type DoorPresence = Point

/** The walls that have a door gap. */
export function doorWalls(walls: readonly PaintedWall[] = PAINTED_ROOM.walls): PaintedWall[] {
  return walls.filter((wall) => wall.door !== undefined)
}

/**
 * Where every door is at `now`: open while a character is within `DOOR_REACH` of its gap, shut again
 * `DOOR_CLOSE_MS` after the last one left, sliding `DOOR_SLIDE_MS` either way. Pure — `previous` is the
 * states this returned last time; without it every door starts shut.
 */
export function doorState(
  sprites: readonly DoorPresence[],
  now: number,
  previous: DoorStates = {},
  walls: readonly PaintedWall[] = PAINTED_ROOM.walls,
): DoorStates {
  const states: DoorStates = {}
  for (const wall of doorWalls(walls)) {
    const gap = wall.door!
    const was = previous[wall.name] ?? { open: 0, at: now, freeSince: now - DOOR_CLOSE_MS }
    const inReach = sprites.some((sprite) => distanceToSegment(sprite, gap.from, gap.to) <= DOOR_REACH)
    const freeSince = inReach ? null : (was.freeSince ?? now)
    const opening = inReach || now - freeSince! < DOOR_CLOSE_MS
    const step = Math.max(0, now - was.at) / DOOR_SLIDE_MS
    const open = Math.min(1, Math.max(0, was.open + (opening ? step : -step)))
    states[wall.name] = { open, at: now, freeSince }
  }
  return states
}

/** One sliding glass panel of a door: the quad it covers when shut, and how far it slides when open. */
export interface DoorPanel {
  /** The panel's face, top-left first, going round: it stands `wall.height` over its stretch of the foot. */
  shut: Point[]
  /** Where the panel's face is at full open, as an offset from `shut`. */
  slide: Point
}

/**
 * The two panels of a door: each covers half the gap when shut and slides its own half-width out of the
 * gap, behind the fixed panel beside it. Painting pixels, so the office view only has to offset them.
 */
export function doorPanels(wall: PaintedWall): [DoorPanel, DoorPanel] {
  const gap = wall.door
  if (!gap) throw new Error(`wall ${wall.name} has no door`)
  const half = { x: (gap.to.x - gap.from.x) / 2, y: (gap.to.y - gap.from.y) / 2 }
  const middle = { x: gap.from.x + half.x, y: gap.from.y + half.y }
  const face = (a: Point, b: Point): Point[] => [
    { x: a.x, y: a.y - wall.height },
    { x: b.x, y: b.y - wall.height },
    { x: b.x, y: b.y },
    { x: a.x, y: a.y },
  ]
  return [
    { shut: face(gap.from, middle), slide: { x: -half.x, y: -half.y } },
    { shut: face(middle, gap.to), slide: half },
  ]
}

/** How deep in the wall the door sits, for drawing: the lowest point of its gap. */
export function doorDepth(wall: PaintedWall): number {
  const gap = wall.door
  return gap ? Math.max(gap.from.y, gap.to.y) : Math.max(wall.from.y, wall.to.y)
}

/** Distance from `p` to the segment `a`→`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
