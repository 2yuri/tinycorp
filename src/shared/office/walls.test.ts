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
  type Tile,
  walkable,
  walkPath,
  wallSegments,
} from './layout'
import { PAINTED_ROOM } from './painted-room'

const layout = officeLayout()
const grid = walkable(layout)
const GLASS = PAINTED_ROOM.walls.find((wall) => wall.name === 'meeting-glass')!
const PARTITION = PAINTED_ROOM.walls.find((wall) => wall.name === 'kitchen-partition')!
/** The cells the glass door's gap leaves open: the only way in or out of the meeting room. */
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

const onAWall = (p: Point) => PAINTED_ROOM.walls.flatMap(wallSegments).some((segment) => inside(p, segment))
const inFurniture = (p: Point) => PAINTED_ROOM.obstacles.some((obstacle) => inside(p, obstacle))
const isWalkable = (p: Point) => {
  const { col, row } = cellOf(p)
  return grid[row]?.[col] === true
}
/** Every desk an Employee can be sent to, as a starting point for a walk. */
const desks = layout.seats.map((seat) => ({ x: seat.x, y: seat.y }))

describe('the painted walls', () => {
  it('blocks the glass front, except at the door gap', () => {
    const on = (x: number) => ({ x, y: 318 + ((x - 686) * (404 - 318)) / (846 - 686) })

    expect(isWalkable(on(700)), 'the left panel').toBe(false)
    expect(isWalkable(on(740)), 'the left panel').toBe(false)
    expect(isWalkable(on(799)), 'the door gap').toBe(true)
    expect(isWalkable(on(840)), 'the right panel').toBe(false)
  })

  it('blocks the kitchen partition all the way down', () => {
    for (let y = PARTITION.from.y + CELL; y < PARTITION.to.y; y += CELL) {
      expect(isWalkable({ x: PARTITION.from.x, y }), `partition at y ${y}`).toBe(false)
    }
  })

  it('walks between every painted chair, and never off the painting to reach one', () => {
    expect(layout.height).toBe(PAINTED_ROOM.height)
    expect(layout.seats.length).toBeGreaterThan(1)
    for (const seat of layout.seats.slice(1)) {
      expect(walkPath(desks[0]!, seat, grid).length, `${seat.uid}`).toBeGreaterThan(0)
    }
  })
})

describe('paths in and out of the meeting room', () => {
  const inMeeting = (p: Point) => inside(p, PAINTED_ROOM.meeting.area)

  it('takes every desk into the meeting room through the door cell, and never over a wall', () => {
    for (const desk of desks) {
      for (const spot of layout.meeting) {
        const path = walkPath(desk, spot, grid)

        expect(path.length, `${desk.x},${desk.y} cannot reach ${spot.x},${spot.y}`).toBeGreaterThan(0)
        const through = path.some((step) => DOOR_CELLS.has(`${cellOf(step).col},${cellOf(step).row}`))
        expect(through, `${desk.x},${desk.y} → ${spot.x},${spot.y} skipped the door`).toBe(true)
        // It crosses the glass front exactly once, at the door.
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

  it('never steps on a wall segment, wherever anyone walks', () => {
    const everywhere: Spot[] = [
      ...layout.meeting,
      ...layout.coffee,
      layout.boss.visitor,
      ...layout.seats.map((s) => s.visitor),
    ]
    for (const desk of desks) {
      for (const goal of everywhere) {
        for (const step of walkPath(desk, goal, grid)) {
          expect(
            onAWall(step),
            `${desk.x},${desk.y} → ${goal.x},${goal.y} stepped on a wall at ${step.x},${step.y}`,
          ).toBe(false)
        }
      }
    }
  })

  it('reaches the coffee counter from every desk without crossing the partition', () => {
    for (const desk of desks) {
      for (const spot of layout.coffee) {
        const path = walkPath(desk, spot, grid)

        expect(path.length, `${desk.x},${desk.y} cannot reach the counter`).toBeGreaterThan(0)
        expect(path.every((step) => step.x < PARTITION.from.x)).toBe(true)
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

  it('keeps every resting spot out of the door\u2019s reach, so nobody holds it open', () => {
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

  it('sits the meeting spots at the table, facing it', () => {
    for (const spot of layout.meeting) {
      expect(inside(spot, PAINTED_ROOM.meeting.area), `${spot.x},${spot.y} is outside the meeting room`).toBe(true)
      expect(inside(spot, PAINTED_ROOM.meeting.table), `${spot.x},${spot.y} is on the table`).toBe(false)
      // Close enough to the table to read as sitting at it, and turned into it: the seated cells are
      // drawn from behind, turned up and to one side, so the table has to be up and on that side.
      expect(nearestOn(spot, PAINTED_ROOM.meeting.table)).toBeLessThan(CELL * 4)
      const near = nearestPointOn(spot, PAINTED_ROOM.meeting.table)
      expect(near.y, `${spot.x},${spot.y} does not face up the table`).toBeLessThan(spot.y)
      expect(spot.facing, `${spot.x},${spot.y}`).toBe(near.x > spot.x ? 'right' : 'left')
    }
  })

  it('stands the coffee spots in one line at the counter, everyone facing it (T107)', () => {
    const [head, ...rest] = layout.coffee

    // The head of the line stands at the counter itself, beside the run the partition carries.
    expect(head!.facing).toBe('right')
    expect(PARTITION.from.x - head!.x, `${head!.x},${head!.y} is not at the counter`).toBeLessThan(CELL * 5)
    expect(head!.y).toBeGreaterThan(PARTITION.from.y)
    expect(head!.y).toBeLessThan(PARTITION.to.y)
    // And everyone behind them is the next place back down the same line, never a body on top of it.
    let ahead = head!
    for (const spot of rest) {
      expect(spot.facing, `${spot.x},${spot.y}`).toBe('right')
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

/** The shortest distance from `p` to any corner or edge midpoint of `polygon`. */
function nearestOn(p: Point, polygon: Point[]): number {
  let best = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const steps = 20
    for (let s = 0; s <= steps; s++) {
      const at = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
      best = Math.min(best, Math.hypot(p.x - at.x, p.y - at.y))
    }
  }
  return best
}

describe('walkable', () => {
  it('leaves the door gap wide enough for a character to pass', () => {
    const open: Tile[] = []
    const gap = GLASS.door!
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (!grid[row]![col]) continue
        const centre = cellCentre({ col, row })
        if (
          Math.abs(centre.x - (gap.from.x + gap.to.x) / 2) <= 40 &&
          Math.abs(centre.y - (gap.from.y + gap.to.y) / 2) <= 25
        )
          open.push({ col, row })
      }
    }

    expect(open.length).toBeGreaterThan(3)
  })
})
