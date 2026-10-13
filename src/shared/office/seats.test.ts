/**
 * Every selectable room, seat by seat (T91). The checks T68 made on the first painting and T84/T85
 * repeated by hand for the Warm Loft and the Night Shift, run over the registry instead, so a room
 * measured later cannot ship without them.
 */
import { describe, expect, it } from 'vitest'
import { DOOR_REACH, distanceToSegment } from './doors'
import {
  CELL,
  cellOf,
  inside,
  type OfficeLayout,
  officeLayout,
  type PaintedWall,
  type Point,
  type Spot,
  walkable,
  walkPath,
  wallSegments,
} from './layout'
import type { PaintedRoom } from './painted-room'
import { isSelectable, ROOMS } from './rooms'

/** Facings the sheet has a seated cell for: the two the room's own 2:1 angle asks for. */
const SEATED_FACINGS = ['left', 'right']

interface Measured {
  room: PaintedRoom
  layout: OfficeLayout
  grid: boolean[][]
  /** Where a character comes to rest, other than in a desk chair. */
  spots: { what: string; spot: Spot }[]
  doorCells: Set<string>
  door: PaintedWall['door']
}

function measure(room: PaintedRoom): Measured {
  const layout = officeLayout(room)
  const grid = walkable(layout)
  const gap = room.walls.find((wall) => wall.door)?.door
  const doorCells = new Set<string>()
  if (gap) {
    const steps = Math.ceil(Math.hypot(gap.to.x - gap.from.x, gap.to.y - gap.from.y))
    for (let i = 0; i <= steps; i++) {
      const at = {
        x: gap.from.x + ((gap.to.x - gap.from.x) * i) / steps,
        y: gap.from.y + ((gap.to.y - gap.from.y) * i) / steps,
      }
      const { col, row } = cellOf(at)
      for (const dr of [-1, 0, 1]) doorCells.add(`${col},${row + dr}`)
    }
  }
  const spots = [
    ...layout.meeting.map((spot, i) => ({ what: `meeting chair ${i}`, spot })),
    ...layout.coffee.map((spot, i) => ({ what: `coffee spot ${i}`, spot })),
    { what: 'the boss visitor', spot: layout.boss.visitor },
    ...layout.seats.map((seat, i) => ({ what: `desk ${i} visitor`, spot: seat.visitor })),
  ]
  return { room, layout, grid, spots, doorCells, door: gap }
}

/** The box every outline of a seat's occluders together covers. */
function occluderBox(outlines: Point[][]): { x: number; y: number; w: number; h: number } {
  const points = outlines.flat()
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

const within = (p: Point, box: { x: number; y: number; w: number; h: number }) =>
  p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h

/** The point on the outline of `polygon` nearest to `p`. */
function nearestPointOn(p: Point, polygon: Point[]): Point {
  let best = polygon[0]!
  let distance = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const steps = 40
    for (let s = 0; s <= steps; s++) {
      const at = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
      const away = Math.hypot(p.x - at.x, p.y - at.y)
      if (away < distance) {
        distance = away
        best = at
      }
    }
  }
  return best
}

const selectable = ROOMS.filter(isSelectable)

describe.each(selectable.map((room) => [room.name, room.geometry] as const))('%s', (name, geometry) => {
  const { room, layout, grid, spots, doorCells, door } = measure(geometry)
  const isWalkable = (p: Point) => grid[cellOf(p).row]?.[cellOf(p).col] === true
  const onAWall = (p: Point) => room.walls.flatMap(wallSegments).some((segment) => inside(p, segment))
  const inFurniture = (p: Point) => room.obstacles.some((obstacle) => inside(p, obstacle))
  /** Every chair a sprite is drawn sitting in: the desks the painting has, and the boss's own. */
  const chairs: { what: string; at: Spot }[] = [
    ...layout.seats.map((seat, i) => ({ what: `desk ${i}`, at: seat })),
    { what: 'the boss chair', at: layout.boss.seat },
  ]

  it('is the painting: 1040 by 660, the framing every room shares', () => {
    expect({ width: room.width, height: room.height }).toEqual({ width: 1040, height: 660 })
  })

  it('seats a sprite in the painted chair: every seat is inside the chair its occluders outline', () => {
    for (const [i, seat] of room.seats.entries()) {
      expect(seat.occluders.length, `desk ${i} has no painted chair`).toBeGreaterThan(0)
      expect(within(seat, occluderBox(seat.occluders)), `desk ${i} sits beside its chair, not in it`).toBe(true)
    }
    const boss = room.boss.occluders
    if (boss) expect(within(room.boss.seat, occluderBox(boss)), `${name}: the boss sits beside their chair`).toBe(true)
  })

  it('turns every sitter the way the sheet can draw them', () => {
    for (const [i, seat] of room.seats.entries()) {
      expect([...SEATED_FACINGS, 'down'], `desk ${i}`).toContain(seat.facing)
    }
    expect(SEATED_FACINGS, 'the boss chair').toContain(room.boss.seat.facing)
    for (const spot of layout.meeting) expect(SEATED_FACINGS, `${spot.x},${spot.y}`).toContain(spot.facing)
  })

  it('stands every chair on walkable floor, off the walls and out of the furniture', () => {
    // A seat whose sitter faces the viewer is inside the desk that hides their legs, by design; every
    // other chair, the boss's own among them, stands on floor a character could walk to.
    for (const { what, at } of chairs) {
      if (at.facing === 'down') continue
      expect(onAWall(at), `${what} is on a wall`).toBe(false)
      expect(inFurniture(at), `${what} is inside furniture`).toBe(false)
      expect(isWalkable(at), `${what} is not walkable`).toBe(true)
    }
  })

  it('stands every resting spot on walkable floor, off the walls and out of the furniture', () => {
    for (const { what, spot } of spots) {
      expect(onAWall(spot), `${what} is on a wall`).toBe(false)
      expect(inFurniture(spot), `${what} is inside furniture`).toBe(false)
      expect(isWalkable(spot), `${what} is not walkable`).toBe(true)
    }
  })

  it('never puts two of them on the same cell', () => {
    const cells = spots.map(({ spot }) => `${cellOf(spot).col},${cellOf(spot).row}`)

    expect(new Set(cells).size).toBe(cells.length)
  })

  it('keeps every resting spot out of the door’s reach, so nobody holds it open', () => {
    for (const { what, spot } of spots) {
      expect(distanceToSegment(spot, door!.from, door!.to), `${what} holds the door open`).toBeGreaterThan(DOOR_REACH)
    }
  })

  it('walks from every seat to every spot and back, and never over a wall', () => {
    for (const { what: from, at } of chairs) {
      for (const { what: to, spot } of spots) {
        const out = walkPath(at, spot, grid)
        expect(out.length, `${from} cannot reach ${to}`).toBeGreaterThan(0)
        expect(walkPath(spot, at, grid).length, `${to} cannot reach ${from}`).toBeGreaterThan(0)
        for (const step of out) {
          expect(onAWall(step), `${from} → ${to} stepped on a wall at ${step.x},${step.y}`).toBe(false)
        }
      }
    }
  })

  it('has one door, and it is the only way into the meeting room', () => {
    expect(
      room.walls.filter((wall) => wall.door),
      `${name}`,
    ).toHaveLength(1)
    const first = chairs[0]!.at
    for (const spot of layout.meeting) {
      const path = walkPath(first, spot, grid)
      const through = path.some((step) => doorCells.has(`${cellOf(step).col},${cellOf(step).row}`))
      expect(through, `${spot.x},${spot.y} was reached without the door`).toBe(true)
    }
    const bricked = grid.map((cells, row) => cells.map((open, col) => open && !doorCells.has(`${col},${row}`)))
    for (const spot of layout.meeting) {
      expect(walkPath(first, spot, bricked), `${spot.x},${spot.y} is reachable around the glass`).toEqual([])
    }
  })

  it('sits the meeting spots at the table, turned into it', () => {
    for (const spot of layout.meeting) {
      expect(inside(spot, room.meeting.area), `${spot.x},${spot.y} is outside the meeting room`).toBe(true)
      expect(inside(spot, room.meeting.table), `${spot.x},${spot.y} is on the table`).toBe(false)
      const near = nearestPointOn(spot, room.meeting.table)
      expect(Math.hypot(spot.x - near.x, spot.y - near.y), `${spot.x},${spot.y} is not at the table`).toBeLessThan(
        CELL * 4,
      )
      expect(near.y, `${spot.x},${spot.y} does not face up the table`).toBeLessThan(spot.y)
      expect(spot.facing, `${spot.x},${spot.y}`).toBe(near.x > spot.x ? 'right' : 'left')
    }
  })

  it('stands the visitor spots beside the desk they visit, within arm’s reach', () => {
    const pairs = [
      ...layout.seats.map((seat, i) => ({ what: `desk ${i}`, at: seat as Spot, visitor: seat.visitor })),
      { what: 'the boss desk', at: layout.boss.seat, visitor: layout.boss.visitor },
    ]
    for (const { what, at, visitor } of pairs) {
      expect(Math.hypot(visitor.x - at.x, visitor.y - at.y), what).toBeLessThan(CELL * 9)
    }
  })

  it('keeps everything walkable on the painted floor', () => {
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (!grid[row]![col]) continue
        const centre = { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL }
        expect(
          inside(centre, room.floor) || inside(centre, room.meeting.area),
          `${centre.x},${centre.y} is walkable but off the floor`,
        ).toBe(true)
      }
    }
  })
})
