/**
 * The office as pure data: the painted room's anchors (`painted-room.ts`), and nothing the painting
 * does not draw. A room seats the chairs its own art paints (T111).
 * Positions are painting pixels; characters walk on a grid of `CELL`-sized cells over the painting.
 */
import {
  PAINTED_ROOM,
  type PaintedRoom,
  type PaintedWall,
  type Point,
  type Rect,
  type Spot,
  type Turn,
} from './painted-room'

/** How much floor a character covers, and the rule two spots keep, both measured in `characters.ts`. */
export { CHARACTER_FOOTPRINT, spotsClash } from './characters'
export type { Facing, PaintedWall, Point, Rect, Spot, Turn } from './painted-room'

/** Painting pixels per walking cell. */
export const CELL = 10

/** How wide a wall's foot blocks the grid: one cell, so a wall is exactly one cell thick. */
export const WALL_THICKNESS = CELL

export interface Seat extends Spot {
  uid: string
  /** For a seat facing the viewer, which way its sitter is turned (see `PaintedSeat`). */
  turn?: Turn
  /** Where a visitor stands to talk to whoever sits here. */
  visitor: Spot
  /** Outlines of what is in front of the sitter: the painting inside them is drawn over them. */
  occluders: Point[][]
}

export interface OfficeLayout {
  /** The world, in painting pixels: the painting, and never a pixel past it. */
  width: number
  height: number
  cols: number
  rows: number
  /** The painting's own size, which `width` and `height` never exceed: the world is the painting. */
  painting: { width: number; height: number }
  /** Seat `i` belongs to desk `i`: the chairs this room's own painting draws, in its own order. */
  seats: Seat[]
  /** The boss's own desk: only ever the boss's, sat at whenever a Company is open (T86). */
  boss: { desk: Rect; seat: Spot; visitor: Spot; occluders?: Point[][] }
  /** Where the Company's logo is painted (T280). */
  logo: PaintedRoom['logo']
  /** Where Employees stand in the meeting room while they talk in a channel. */
  meeting: Spot[]
  meetingArea: Point[]
  /** Where Employees wait in the kitchen corner while they are blocked, parked or out of budget. */
  coffee: Spot[]
  /** The walls between the rooms; their solid stretches are in `blocked`, their door gaps are not. */
  walls: PaintedWall[]
  /** Areas to walk on, and areas not to. */
  walkable: Point[][]
  blocked: Point[][]
}

/**
 * The solid stretches of a wall's foot, as `WALL_THICKNESS`-thick quads: the whole foot when it has no door,
 * otherwise the stretch each side of the door gap. Nothing walks on these; `findPath` routes through the gap.
 */
export function wallSegments(wall: PaintedWall): Point[][] {
  const ends: [Point, Point][] = wall.door
    ? [
        [wall.from, wall.door.from],
        [wall.door.to, wall.to],
      ]
    : [[wall.from, wall.to]]
  return ends.filter(([a, b]) => a.x !== b.x || a.y !== b.y).map(([a, b]) => band(a, b, WALL_THICKNESS))
}

/** A quad `thickness` px wide, centred on the segment `a`→`b` and overhanging each end by half of it. */
function band(a: Point, b: Point, thickness: number): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  const out = { x: (-along.y * thickness) / 2, y: (along.x * thickness) / 2 }
  const over = { x: (along.x * thickness) / 2, y: (along.y * thickness) / 2 }
  const from = { x: a.x - over.x, y: a.y - over.y }
  const to = { x: b.x + over.x, y: b.y + over.y }
  return [
    { x: from.x + out.x, y: from.y + out.y },
    { x: to.x + out.x, y: to.y + out.y },
    { x: to.x - out.x, y: to.y - out.y },
    { x: from.x - out.x, y: from.y - out.y },
  ]
}

/**
 * Every desk a room has: the chairs its own painting draws, and no more (T111). The world is the
 * painting and nothing else — a Company bigger than that waits at the coffee counter
 * (`NO_DESK_REASON`) rather than sitting at furniture nobody drew for it.
 * Desk `i` sits in the same place whatever the Company's size.
 */
export function officeLayout(room: PaintedRoom = PAINTED_ROOM): OfficeLayout {
  const seats: Seat[] = room.seats.map((seat, i) => ({
    uid: `desk-${i}`,
    x: seat.x,
    y: seat.y,
    facing: seat.facing,
    ...(seat.turn ? { turn: seat.turn } : {}),
    visitor: seat.visitor,
    occluders: seat.occluders,
  }))
  return {
    width: room.width,
    height: room.height,
    cols: Math.ceil(room.width / CELL),
    rows: Math.ceil(room.height / CELL),
    painting: { width: room.width, height: room.height },
    seats,
    boss: room.boss,
    logo: room.logo,
    meeting: room.meeting.spots,
    meetingArea: room.meeting.area,
    coffee: room.coffee.spots,
    walls: room.walls,
    walkable: [room.floor, room.meeting.area],
    blocked: [...room.obstacles, ...room.walls.flatMap(wallSegments), rectPoints(room.boss.desk)],
  }
}

/** `grid[row][col]` is true where a character can walk: on the floor and off the furniture. */
export function walkable(layout: OfficeLayout): boolean[][] {
  const grid = Array.from({ length: layout.rows }, (_, row) =>
    Array.from({ length: layout.cols }, (_, col) => {
      const centre = cellCentre({ col, row })
      return layout.walkable.some((a) => inside(centre, a)) && !layout.blocked.some((b) => inside(centre, b))
    }),
  )
  for (const seat of layout.seats) if (seat.facing === 'down') openTheWayTo(grid, seat)
  return grid
}

/**
 * The way in and out of a chair the painting tucks in on the far side of a run: the straight line
 * from the seat to the spot its visitor stands on. That chair's own floor is under the desk, which
 * the grid blocks, so without this its sitter would have nowhere to walk to or from (T103); they
 * slide the chair out the way anyone would, towards the open floor the visitor is already on.
 */
function openTheWayTo(grid: boolean[][], seat: Seat): void {
  const open = (col: number, row: number) => {
    if (grid[row]?.[col] !== undefined) grid[row]![col] = true
  }
  const steps = Math.ceil(Math.hypot(seat.visitor.x - seat.x, seat.visitor.y - seat.y) / (CELL / 2))
  let last = cellOf(seat)
  open(last.col, last.row)
  for (let i = 1; i <= steps; i++) {
    const at = cellOf({
      x: seat.x + ((seat.visitor.x - seat.x) * i) / steps,
      y: seat.y + ((seat.visitor.y - seat.y) * i) / steps,
    })
    // A step that crosses a corner opens the cell beside it too: paths are 4-way, so two cells that
    // touch only at their corners are no way through at all.
    if (at.col !== last.col && at.row !== last.row) open(last.col, at.row)
    open(at.col, at.row)
    last = at
  }
}

export interface Tile {
  col: number
  row: number
}

export function cellOf(point: Point): Tile {
  return { col: Math.floor(point.x / CELL), row: Math.floor(point.y / CELL) }
}

export function cellCentre(tile: Tile): Point {
  return { x: (tile.col + 0.5) * CELL, y: (tile.row + 0.5) * CELL }
}

/** Where a visitor stands to talk to whoever sits in `seat`. */
export function visitorSpot(seat: Pick<Seat, 'visitor'>): Spot {
  return seat.visitor
}

/**
 * Shortest 4-way path from `start` to `goal`, without `start`; empty when there is none.
 * `start` and `goal` may be blocked (a character leaves and reaches a chair).
 * Ported from Pixel Agents (github.com/pablodelucca/pixel-agents, MIT,
 * webview-ui/src/office/layout/tileMap.ts `findPath`): BFS on the tile grid.
 */
export function findPath(start: Tile, goal: Tile, grid: boolean[][]): Tile[] {
  if (start.col === goal.col && start.row === goal.row) return []
  const key = (col: number, row: number) => `${col},${row}`
  const open = (col: number, row: number) => (col === goal.col && row === goal.row) || grid[row]?.[col] === true
  const cameFrom = new Map<string, Tile | null>([[key(start.col, start.row), null]])
  const queue: Tile[] = [{ col: start.col, row: start.row }]
  const steps = [
    { dc: 0, dr: -1 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
  ]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    if (current.col === goal.col && current.row === goal.row) {
      const path: Tile[] = []
      for (let at: Tile | null = current; at && cameFrom.get(key(at.col, at.row)); ) {
        path.unshift(at)
        at = cameFrom.get(key(at.col, at.row))!
      }
      return path
    }
    for (const { dc, dr } of steps) {
      const col = current.col + dc
      const row = current.row + dr
      if (cameFrom.has(key(col, row)) || !open(col, row)) continue
      cameFrom.set(key(col, row), current)
      queue.push({ col, row })
    }
  }
  return []
}

/**
 * The path from `from` to `to` in painting pixels: through the centres of the cells on the way,
 * ending exactly on `to`. Empty when `to` cannot be reached.
 */
export function walkPath(from: Point, to: Point, grid: boolean[][]): Point[] {
  const goal = cellOf(to)
  const start = cellOf(from)
  if (start.col === goal.col && start.row === goal.row) return from.x === to.x && from.y === to.y ? [] : [to]
  const cells = findPath(start, goal, grid)
  if (cells.length === 0) return []
  return [...cells.slice(0, -1).map(cellCentre), { x: to.x, y: to.y }]
}

function rectPoints({ x, y, w, h }: Rect): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

/** Even-odd point-in-polygon. */
export function inside(p: Point, polygon: Point[]): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}
