/**
 * Every seat of every measured room, against the rule T103 holds the rooms to: a sitter sits on a
 * chair the painting draws, behind the desk in front of them.
 *
 * 1. The sprite's chair stands on the floor the painting's own chair stands on — the seat is on the
 *    painted floor, and inside no painted furniture but the run its own occluders draw back over it.
 * 2. Everything the painting draws between the viewer and the sitter is drawn again over them: every
 *    seat carries an occluder that holds its foot and reaches below it, which is what puts the
 *    painting over the sprite and sorts it in front — and no seat is cut by a band that is not its own.
 * 3. A sitter reads the same size as their neighbours: that one is on the sheet, in
 *    `src/renderer/src/office/character-sheet.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { inside, officeLayout, type Point, type Seat } from './layout'
import { isSelectable, ROOMS } from './rooms'

/**
 * How much of the painting one sitter covers, from their feet: the widest and tallest cell of
 * `characters.png` at `CHARACTER_SCALE`, rounded up. A band that reaches into this box cuts them.
 */
const SPRITE_HALF_WIDTH = 34
const SPRITE_HEIGHT = 110

const spriteBox = (seat: Point) => ({
  left: seat.x - SPRITE_HALF_WIDTH,
  right: seat.x + SPRITE_HALF_WIDTH,
  top: seat.y - SPRITE_HEIGHT,
  bottom: seat.y,
})

/** An outline as a string, so the two chairs that share one run's band can tell it is the same one. */
const outlineKey = (outline: Point[]) => outline.map((p) => `${p.x},${p.y}`).join(' ')

/** How the office sorts an occluder against the walkers: by the lowest point of its outline. */
const sortsAt = (outline: Point[]) => Math.max(...outline.map((p) => p.y))

/** The box a polygon fills, in the shape `covers` samples. */
const boxOf = (outline: Point[]) => ({
  left: Math.min(...outline.map((p) => p.x)),
  right: Math.max(...outline.map((p) => p.x)),
  top: Math.min(...outline.map((p) => p.y)),
  bottom: Math.max(...outline.map((p) => p.y)),
})

/** Whether a polygon covers any part of a box, sampled the way the layout samples its own overlaps. */
function covers(outline: Point[], box: ReturnType<typeof spriteBox>): boolean {
  for (let y = box.top; y <= box.bottom; y += 4) {
    for (let x = box.left; x <= box.right; x += 4) {
      if (inside({ x, y }, outline)) return true
    }
  }
  return false
}

const selectable = ROOMS.filter(isSelectable)

describe.each(selectable.map((room) => [room.name, room.geometry] as const))('%s', (_name, geometry) => {
  const layout = officeLayout(geometry)
  const where = (seat: Seat, i: number) => `${seat.uid} at ${seat.x},${seat.y} (${i})`

  it('stands every seat on the painted floor', () => {
    for (const [i, seat] of layout.seats.entries()) {
      expect(inside(seat, geometry.floor), `${where(seat, i)} is off the floor`).toBe(true)
    }
  })

  it('draws the painting back over every sitter, from over their foot down past it', () => {
    for (const [i, seat] of layout.seats.entries()) {
      expect(seat.occluders.length, `${where(seat, i)} has nothing drawn over it`).toBeGreaterThan(0)
      const holding = seat.occluders.filter((outline) => inside(seat, outline))
      expect(holding.length, `${where(seat, i)} sits beside what is drawn over it, not under it`).toBeGreaterThan(0)
      const lowest = Math.max(...seat.occluders.map(sortsAt))
      expect(lowest, `${where(seat, i)} sorts in front of what should cover it`).toBeGreaterThan(seat.y)
    }
  })

  it('sits every sitter drawn from the front at a painted run, turned, and in no other furniture', () => {
    for (const [i, seat] of layout.seats.entries()) {
      if (seat.facing !== 'down') continue
      // A chair the painting tucks in on the far side of a run is drawn seated, never standing.
      expect(seat.turn, `${where(seat, i)} is not turned, so it would be drawn standing`).toBeDefined()
      // And it is at a run: what is drawn over the sitter is the painting's own desk, not a stretch
      // of the walkway beside it, which would redraw the floor over them and leave them cut in air.
      const atARun = seat.occluders.some((outline) =>
        geometry.obstacles.some((obstacle) => covers(outline, boxOf(obstacle))),
      )
      expect(atARun, `${where(seat, i)} has a band over the walkway, not over a desk`).toBe(true)
      for (const obstacle of geometry.obstacles) {
        if (!inside(seat, obstacle)) continue
        // The only painted furniture a seat may stand in is the run its own band draws back over it.
        const redrawn = seat.occluders.some(
          (outline) => covers(outline, spriteBox(seat)) && covers(obstacle, spriteBox(seat)),
        )
        expect(redrawn, `${where(seat, i)} stands in furniture nothing draws back over it`).toBe(true)
      }
    }
  })

  it('leaves every sitter drawn from behind clear of the painting’s own furniture', () => {
    for (const [i, seat] of layout.seats.entries()) {
      if (seat.facing === 'down') continue
      for (const obstacle of geometry.obstacles) {
        expect(inside(seat, obstacle), `${where(seat, i)} is inside painted furniture`).toBe(false)
      }
    }
  })

  it('never cuts a sitter with a band that is not their own', () => {
    for (const [i, seat] of layout.seats.entries()) {
      const box = spriteBox(seat)
      const mine = seat.occluders.map(outlineKey)
      for (const [j, other] of layout.seats.entries()) {
        if (i === j) continue
        for (const outline of other.occluders) {
          // Two chairs at the same run share one band, and a band never cuts the sitters it is for.
          if (mine.includes(outlineKey(outline))) continue
          if (sortsAt(outline) <= seat.y) continue
          expect(covers(outline, box), `${where(seat, i)} is cut by ${where(other, j)}’s own occluder`).toBe(false)
        }
      }
    }
  })
})
