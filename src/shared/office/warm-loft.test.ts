/**
 * The Warm Loft's geometry, in its own coordinates: the checks T68 made on the painted office
 * (`walls.test.ts`), run against `WARM_LOFT_ROOM` instead. Nothing here reads `PAINTED_ROOM`.
 */
import { describe, expect, it } from 'vitest'
import { DOOR_REACH, distanceToSegment } from './doors'
import { CELL, cellOf, inside, officeLayout, type Point, type Spot, walkable, walkPath, wallSegments } from './layout'
import { WARM_LOFT_LOUNGE, WARM_LOFT_ROOM } from './warm-loft'

const room = WARM_LOFT_ROOM
const layout = officeLayout(room)
const grid = walkable(layout)
const GLASS = room.walls.find((wall) => wall.name === 'meeting-glass')!
const GAP = GLASS.door!

/** The cells the glass door's gap leaves open: the only way in or out of the meeting room. */
const DOOR_CELLS = doorCells()

function doorCells(): Set<string> {
  const cells = new Set<string>()
  const steps = Math.ceil(Math.hypot(GAP.to.x - GAP.from.x, GAP.to.y - GAP.from.y))
  for (let i = 0; i <= steps; i++) {
    const at = {
      x: GAP.from.x + ((GAP.to.x - GAP.from.x) * i) / steps,
      y: GAP.from.y + ((GAP.to.y - GAP.from.y) * i) / steps,
    }
    const { col, row } = cellOf(at)
    for (const dr of [-1, 0, 1]) cells.add(`${col},${row + dr}`)
  }
  return cells
}

const onAWall = (p: Point) => room.walls.flatMap(wallSegments).some((segment) => inside(p, segment))
const inFurniture = (p: Point) => room.obstacles.some((obstacle) => inside(p, obstacle))
const isWalkable = (p: Point) => {
  const { col, row } = cellOf(p)
  return grid[row]?.[col] === true
}
const inMeeting = (p: Point) => inside(p, room.meeting.area)
/** Every desk an Employee can be sent to, as a starting point for a walk. */
const desks = layout.seats.map((seat) => ({ x: seat.x, y: seat.y }))

/** Where a character rests: the meeting chairs, the coffee corner and the spots beside a desk. */
const spots: { what: string; spot: Spot }[] = [
  ...layout.meeting.map((spot, i) => ({ what: `meeting chair ${i}`, spot })),
  ...layout.coffee.map((spot, i) => ({ what: `coffee spot ${i}`, spot })),
  { what: 'the boss visitor', spot: layout.boss.visitor },
  ...layout.seats.map((seat, i) => ({ what: `desk ${i} visitor`, spot: seat.visitor })),
]

describe('the loft the painting measures out', () => {
  it('is the painting: 1040 by 660, the framing every room shares', () => {
    expect({ width: room.width, height: room.height }).toEqual({ width: 1040, height: 660 })
    expect({ width: layout.width, height: layout.height }).toEqual({ width: 1040, height: 660 })
  })

  it('seats the four Employees its painting draws chairs for, and no more (T111)', () => {
    expect(room.seats).toHaveLength(4)
    expect(layout.seats).toHaveLength(4)
  })

  it('has one wall, the glass front, and one door in it', () => {
    expect(room.walls.map((wall) => wall.name)).toEqual(['meeting-glass'])
    expect(room.walls.filter((wall) => wall.door)).toHaveLength(1)
  })
})

describe('the glass front of the Warm Loft', () => {
  /** A point on the glass front's foot at `x`. */
  const on = (x: number) => ({
    x,
    y: GLASS.from.y + ((x - GLASS.from.x) * (GLASS.to.y - GLASS.from.y)) / (GLASS.to.x - GLASS.from.x),
  })

  it('blocks the glass, except at the door gap the painting draws open', () => {
    expect(isWalkable(on(670)), 'the left panel').toBe(false)
    expect(isWalkable(on(696)), 'the left panel').toBe(false)
    expect(isWalkable(on(740)), 'the door gap').toBe(true)
    expect(isWalkable(on(800)), 'the right panel').toBe(false)
  })

  it('leaves the gap wide enough for a character to pass', () => {
    const middle = { x: (GAP.from.x + GAP.to.x) / 2, y: (GAP.from.y + GAP.to.y) / 2 }
    const open: Point[] = []
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (!grid[row]![col]) continue
        const centre = { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL }
        if (Math.abs(centre.x - middle.x) <= 40 && Math.abs(centre.y - middle.y) <= 25) open.push(centre)
      }
    }

    expect(open.length).toBeGreaterThan(3)
  })
})

describe('paths in and out of the meeting room', () => {
  it('takes every desk into the meeting room through the door cell, and never over the glass', () => {
    for (const desk of desks) {
      for (const spot of layout.meeting) {
        const path = walkPath(desk, spot, grid)

        expect(path.length, `${desk.x},${desk.y} cannot reach ${spot.x},${spot.y}`).toBeGreaterThan(0)
        const through = path.some((step) => DOOR_CELLS.has(`${cellOf(step).col},${cellOf(step).row}`))
        expect(through, `${desk.x},${desk.y} → ${spot.x},${spot.y} skipped the door`).toBe(true)
        const crossings = path.filter((step, i) => i > 0 && inMeeting(step) !== inMeeting(path[i - 1]!))
        expect(crossings.length, `${desk.x},${desk.y} → ${spot.x},${spot.y} crossings`).toBe(1)
      }
    }
  })

  it('has no other way in: brick the gap up and the meeting room is cut off', () => {
    const bricked = grid.map((cells, row) => cells.map((open, col) => open && !DOOR_CELLS.has(`${col},${row}`)))

    for (const spot of layout.meeting) {
      expect(walkPath(desks[0]!, spot, bricked), `${spot.x},${spot.y} is reachable around the glass`).toEqual([])
    }
  })

  it('walks back out of the meeting room through the door too', () => {
    for (const spot of layout.meeting) {
      const path = walkPath(spot, desks[0]!, grid)

      expect(path.length).toBeGreaterThan(0)
      expect(path.some((step) => DOOR_CELLS.has(`${cellOf(step).col},${cellOf(step).row}`))).toBe(true)
    }
  })

  it('never steps on the glass, wherever anyone walks', () => {
    for (const desk of desks) {
      for (const { what, spot } of spots) {
        const path = walkPath(desk, spot, grid)

        expect(path.length, `${desk.x},${desk.y} cannot reach ${what}`).toBeGreaterThan(0)
        for (const step of path) {
          expect(onAWall(step), `${desk.x},${desk.y} → ${what} stepped on the glass at ${step.x},${step.y}`).toBe(false)
        }
      }
    }
  })
})

describe('the spots characters stand and sit on', () => {
  it('is walkable, off the glass and out of the furniture, every one of them', () => {
    for (const { what, spot } of spots) {
      expect(onAWall(spot), `${what} is on the glass`).toBe(false)
      expect(inFurniture(spot), `${what} is inside furniture`).toBe(false)
      expect(isWalkable(spot), `${what} is not walkable`).toBe(true)
    }
  })

  it('keeps every resting spot out of the door’s reach, so nobody holds it open', () => {
    for (const { what, spot } of spots) {
      expect(distanceToSegment(spot, GAP.from, GAP.to), `${what} holds the door open`).toBeGreaterThan(DOOR_REACH)
    }
  })

  it('never puts two of them on the same cell', () => {
    const cells = spots.map(({ spot }) => `${cellOf(spot).col},${cellOf(spot).row}`)

    expect(new Set(cells).size).toBe(cells.length)
  })

  it('sits the meeting spots at the table, facing it', () => {
    for (const spot of layout.meeting) {
      expect(inMeeting(spot), `${spot.x},${spot.y} is outside the meeting room`).toBe(true)
      expect(inside(spot, room.meeting.table), `${spot.x},${spot.y} is on the table`).toBe(false)
      expect(nearestOn(spot, room.meeting.table)).toBeLessThan(CELL * 4)
      // Turned into the table: the seated cells are drawn from behind, turned up and to one side,
      // so the nearest bit of the table has to be up and on the side the spot names.
      const near = nearestPointOn(spot, room.meeting.table)
      expect(near.y, `${spot.x},${spot.y} does not face up the table`).toBeLessThan(spot.y)
      expect(spot.facing, `${spot.x},${spot.y}`).toBe(near.x > spot.x ? 'right' : 'left')
    }
  })

  it('stands the coffee spots at the lounge, facing into it', () => {
    // The loft's kitchen is painted behind the glass box, so its coffee corner is the lounge.
    for (const spot of layout.coffee) {
      expect(spot.facing).toBe('up')
      expect(inMeeting(spot), `${spot.x},${spot.y} is in the meeting room`).toBe(false)
      expect(Math.min(...WARM_LOFT_LOUNGE.map((piece) => nearestOn(spot, piece))), `${spot.x},${spot.y}`).toBeLessThan(
        CELL * 6,
      )
    }
  })

  it('never leaves a sprite standing in the open middle: every spot is at something painted', () => {
    for (const { what, spot } of spots) {
      expect(
        Math.min(...room.obstacles.map((piece) => nearestOn(spot, piece))),
        `${what} stands in the open`,
      ).toBeLessThan(CELL * 6)
    }
  })

  it('stands the visitor spots beside the desk they visit, within arm’s reach', () => {
    const seats = [
      ...layout.seats.map((seat) => ({ at: seat, visitor: seat.visitor })),
      { at: layout.boss.seat, visitor: layout.boss.visitor },
    ]
    for (const { at, visitor } of seats) {
      expect(Math.hypot(visitor.x - at.x, visitor.y - at.y), `${visitor.x},${visitor.y}`).toBeLessThan(CELL * 9)
    }
  })
})

describe('the painted furniture', () => {
  it('keeps the floor off the walls: nothing walkable is outside the painted floor', () => {
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (!grid[row]![col]) continue
        const centre = { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL }
        expect(
          inside(centre, room.floor) || inMeeting(centre),
          `${centre.x},${centre.y} is walkable but off the floor`,
        ).toBe(true)
      }
    }
  })

  it('seats every painted chair where the painting draws one, with an occluder over it', () => {
    for (const [i, seat] of room.seats.entries()) {
      expect(seat.occluders.length, `seat ${i}`).toBeGreaterThan(0)
      expect(
        seat.occluders.every((outline) => outline.length >= 3),
        `seat ${i}`,
      ).toBe(true)
      expect(inside(seat, room.floor) || inMeeting(seat), `seat ${i} is off the floor`).toBe(true)
    }
  })
})

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

/** The shortest distance from `p` to any point on the outline of `polygon`. */
function nearestOn(p: Point, polygon: Point[]): number {
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    best = Math.min(best, distanceToSegment(p, a, b))
  }
  return best
}
