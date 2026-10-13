import { describe, expect, it } from 'vitest'
import { DOOR_REACH, distanceToSegment } from './doors'
import {
  CELL,
  CHARACTER_FOOTPRINT,
  cellCentre,
  cellOf,
  inside,
  officeLayout,
  type Point,
  type Spot,
  spotsClash,
  walkable,
  walkPath,
  wallSegments,
} from './layout'
import { KITCHEN_COUNTER, NIGHT_SHIFT_ROOM } from './night-shift-room'
import { roomGeometry } from './rooms'

const room = NIGHT_SHIFT_ROOM
const layout = officeLayout(room)
const grid = walkable(layout)
const GLASS = room.walls.find((wall) => wall.name === 'meeting-glass')!
const RIGHT_GLASS = room.walls.find((wall) => wall.name === 'meeting-glass-right')!
/** The cells the sliding door's gap leaves open: the only way in or out of the meeting cube. */
const DOOR_CELLS = doorCells()

function doorCells(): Set<string> {
  const gap = GLASS.door!
  const cells = new Set<string>()
  const steps = Math.ceil(Math.hypot(gap.to.x - gap.from.x, gap.to.y - gap.from.y))
  for (let i = 0; i <= steps; i++) {
    const at = {
      x: gap.from.x + ((gap.to.x - gap.from.x) * i) / steps,
      y: gap.from.y + ((gap.to.y - gap.from.y) * i) / steps,
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
/** Every desk an Employee can be sent to, as a starting point for a walk. */
const desks = layout.seats.map((seat) => ({ x: seat.x, y: seat.y }))
/**
 * The clear boards the painting leaves in the middle of the floor: walked over, never stood on.
 * Measured between the desk island, the meeting cube's glass and the couches.
 */
const OPEN_MIDDLE = [
  { x: 470, y: 340 },
  { x: 660, y: 400 },
  { x: 640, y: 520 },
  { x: 430, y: 470 },
]

describe('the Night Shift room', () => {
  it('is the geometry the registry hands out for its slug', () => {
    expect(roomGeometry('night-shift')).toBe(room)
    expect({ width: room.width, height: room.height }).toEqual({ width: 1040, height: 660 })
  })

  it('hangs its logo on a neon plaque on the wall, skewed along it (T280)', () => {
    const [spot] = room.logo
    const [topLeft, topRight] = spot!.corners

    // The wall falls away to the right at the room's own 1:2, and nobody walks over a wall.
    expect((topRight.y - topLeft.y) / (topRight.x - topLeft.x)).toBe(0.5)
    expect(spot!.plaque?.art).toBe('office/plaques/night-shift.png')
    for (const corner of spot!.corners) {
      expect(inside(corner, room.floor), `the plaque reaches the floor at ${corner.x},${corner.y}`).toBe(false)
    }
  })

  it('seats the chairs its painting draws and no more, all inside the painting (T111)', () => {
    expect(layout.seats).toHaveLength(room.seats.length)
    expect(layout.height).toBe(room.height)
  })
})

describe('the glass of the meeting cube', () => {
  it('blocks both fronts, except at the door gap', () => {
    const onLeft = (x: number) => ({
      x,
      y: GLASS.from.y + ((x - GLASS.from.x) * (GLASS.to.y - GLASS.from.y)) / (GLASS.to.x - GLASS.from.x),
    })
    const onRight = (x: number) => ({
      x,
      y:
        RIGHT_GLASS.from.y +
        ((x - RIGHT_GLASS.from.x) * (RIGHT_GLASS.to.y - RIGHT_GLASS.from.y)) / (RIGHT_GLASS.to.x - RIGHT_GLASS.from.x),
    })

    expect(isWalkable(onLeft(556)), 'the pane left of the door').toBe(false)
    expect(isWalkable(onLeft(594)), 'the door gap').toBe(true)
    expect(isWalkable(onLeft(650)), 'the pane right of the door').toBe(false)
    for (let x = RIGHT_GLASS.from.x + CELL; x < RIGHT_GLASS.to.x; x += CELL) {
      expect(isWalkable(onRight(x)), `the right front at x ${x}`).toBe(false)
    }
  })

  it('leaves the door gap wide enough for a character to pass', () => {
    const gap = GLASS.door!
    const middle = { x: (gap.from.x + gap.to.x) / 2, y: (gap.from.y + gap.to.y) / 2 }
    let open = 0
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (!grid[row]![col]) continue
        const centre = cellCentre({ col, row })
        if (Math.abs(centre.x - middle.x) <= 40 && Math.abs(centre.y - middle.y) <= 25) open++
      }
    }

    expect(open).toBeGreaterThan(3)
  })
})

describe('paths in and out of the meeting cube', () => {
  const inMeeting = (p: Point) => inside(p, room.meeting.area)

  it('takes every desk into the meeting room through the door cell, and never over a wall', () => {
    for (const desk of desks) {
      for (const spot of layout.meeting) {
        const path = walkPath(desk, spot, grid)

        expect(path.length, `${desk.x},${desk.y} cannot reach ${spot.x},${spot.y}`).toBeGreaterThan(0)
        const through = path.some((step) => DOOR_CELLS.has(`${cellOf(step).col},${cellOf(step).row}`))
        expect(through, `${desk.x},${desk.y} → ${spot.x},${spot.y} skipped the door`).toBe(true)
        // It crosses the glass exactly once, at the door.
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

  it('never steps on a wall or through furniture, wherever anyone walks', () => {
    const everywhere: Spot[] = [
      ...layout.meeting,
      ...layout.coffee,
      layout.boss.visitor,
      ...layout.seats.map((seat) => seat.visitor),
    ]
    for (const desk of desks) {
      for (const goal of everywhere) {
        const path = walkPath(desk, goal, grid)
        expect(path.length, `${desk.x},${desk.y} cannot reach ${goal.x},${goal.y}`).toBeGreaterThan(0)
        for (const step of path) {
          expect(onAWall(step), `${desk.x},${desk.y} → ${goal.x},${goal.y} stepped on a wall`).toBe(false)
          expect(inFurniture(step), `${desk.x},${desk.y} → ${goal.x},${goal.y} walked through furniture`).toBe(false)
        }
      }
    }
  })
})

describe('the spots characters stand and sit on', () => {
  const spots: { what: string; spot: Spot }[] = [
    ...layout.meeting.map((spot, i) => ({ what: `meeting chair ${i}`, spot })),
    ...layout.coffee.map((spot, i) => ({ what: `coffee spot ${i}`, spot })),
    { what: 'the boss visitor', spot: layout.boss.visitor },
    ...layout.seats.map((seat, i) => ({ what: `desk ${i} visitor`, spot: seat.visitor })),
  ]

  it('is walkable, off the walls and out of the furniture, every one of them', () => {
    for (const { what, spot } of spots) {
      expect(onAWall(spot), `${what} is on a wall`).toBe(false)
      expect(inFurniture(spot), `${what} is inside furniture`).toBe(false)
      expect(isWalkable(spot), `${what} is not walkable`).toBe(true)
    }
  })

  it('keeps every resting spot out of the door’s reach, so nobody holds it open', () => {
    for (const { what, spot } of spots) {
      expect(distanceToSegment(spot, GLASS.door!.from, GLASS.door!.to), `${what} holds the door open`).toBeGreaterThan(
        DOOR_REACH,
      )
    }
  })

  it('never puts two of them on the same cell', () => {
    const cells = spots.map(({ spot }) => `${cellOf(spot).col},${cellOf(spot).row}`)

    expect(new Set(cells).size).toBe(cells.length)
  })

  it('sits the meeting spots at the table, inside the cube, facing it', () => {
    for (const spot of layout.meeting) {
      expect(inside(spot, room.meeting.area), `${spot.x},${spot.y} is outside the meeting room`).toBe(true)
      expect(inside(spot, room.meeting.table), `${spot.x},${spot.y} is on the table`).toBe(false)
      expect(nearestOn(spot, room.meeting.table)).toBeLessThan(CELL * 4)
      // Turned into the table: the seated cells are drawn from behind, turned up and to one side,
      // so the nearest bit of the table has to be up and on the side the spot names.
      const near = nearestPointOn(spot, room.meeting.table)
      expect(near.y, `${spot.x},${spot.y} does not face up the table`).toBeLessThan(spot.y)
      expect(spot.facing, `${spot.x},${spot.y}`).toBe(near.x > spot.x ? 'right' : 'left')
    }
  })

  it('stands the coffee spots in one line on the boards before the counter, facing it (T107)', () => {
    const [head, ...rest] = layout.coffee

    // The head of the line stands at the counter; the boards before it are a wedge, so the rest of
    // the line goes up it and turns back down the rug rather than standing inside the people at it.
    expect(head!.facing).toBe('up')
    expect(nearestOn(head!, KITCHEN_COUNTER), `${head!.x},${head!.y} is not at the counter`).toBeLessThan(CELL * 8)
    let ahead = head!
    for (const spot of rest) {
      expect(spot.facing, `${spot.x},${spot.y}`).toBe('up')
      expect(inside(spot, KITCHEN_COUNTER), `${spot.x},${spot.y} is behind the counter`).toBe(false)
      expect(spotsClash(spot, ahead), `${spot.x},${spot.y} stands on ${ahead.x},${ahead.y}`).toBe(false)
      expect(
        Math.hypot(spot.x - ahead.x, spot.y - ahead.y),
        `${spot.x},${spot.y} is not the next place in the line`,
      ).toBeLessThan(CHARACTER_FOOTPRINT * 2)
      ahead = spot
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

describe('the clear boards in the middle', () => {
  it('are crossed, from the desks to the couches, without leaving the floor', () => {
    const path = walkPath({ x: 440, y: 460 }, { x: 660, y: 390 }, grid)

    expect(path.length).toBeGreaterThan(0)
    for (const step of path) {
      expect(inside(step, room.floor), `${step.x},${step.y} left the floor`).toBe(true)
      expect(onAWall(step), `${step.x},${step.y} stepped on a wall`).toBe(false)
    }
  })

  it('never hold a painted sprite: every seat, chair and coffee spot is at a painted thing', () => {
    const painted: Spot[] = [
      ...room.seats,
      ...room.seats.map((seat) => seat.visitor),
      ...room.meeting.spots,
      ...room.coffee.spots,
      room.boss.seat,
      room.boss.visitor,
    ]
    for (const spot of painted) {
      expect(inside(spot, OPEN_MIDDLE), `${spot.x},${spot.y} stands in the open middle`).toBe(false)
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
