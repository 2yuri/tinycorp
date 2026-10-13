import { describe, expect, it } from 'vitest'
import { CHARACTER_FOOTPRINT, spotsClash } from './characters'
import { coffeeQueue } from './coffee-queue'
import type { Spot } from './painted-room'

/** A leg of a queue's path: from `a` to `b`, everyone on it facing the same way. */
const leg = (x: number, y: number, facing: Spot['facing'] = 'up'): Spot => ({ x, y, facing })

describe('the line at a coffee corner', () => {
  it('starts at the head of the queue, where the path starts', () => {
    const queue = coffeeQueue([leg(100, 200), leg(400, 200)], 3)

    expect(queue[0]).toEqual({ x: 100, y: 200, facing: 'up' })
  })

  it('leaves a whole body between everyone standing in it', () => {
    const queue = coffeeQueue([leg(100, 200), leg(400, 200)], 6)

    for (const [i, one] of queue.entries()) {
      for (const other of queue.slice(i + 1)) {
        expect(spotsClash(one, other), `${one.x},${one.y} ~ ${other.x},${other.y}`).toBe(false)
      }
    }
    expect(queue.map((spot) => spot.x)).toEqual([100, 140, 180, 220, 260, 300])
  })

  it('measures that body the way `spotsClash` does, so a diagonal run is not packed tighter', () => {
    // A leg at the room's own angle: a step 40 px long down it would leave two people 28 px apart in
    // x and in y, which reads as one of them standing inside the other.
    const queue = coffeeQueue([leg(0, 0), leg(400, 400)], 3)

    expect(queue).toEqual([
      { x: 0, y: 0, facing: 'up' },
      { x: 40, y: 40, facing: 'up' },
      { x: 80, y: 80, facing: 'up' },
    ])
    for (const spot of queue.slice(1)) expect(spot.x).toBeGreaterThanOrEqual(CHARACTER_FOOTPRINT)
  })

  it('turns the corner the path turns, and faces people the way that leg does', () => {
    const queue = coffeeQueue([leg(100, 100, 'right'), leg(100, 220, 'left'), leg(0, 220, 'left')], 5)

    expect(queue).toEqual([
      { x: 100, y: 100, facing: 'right' },
      { x: 100, y: 140, facing: 'right' },
      { x: 100, y: 180, facing: 'right' },
      // Whoever stands right on the corner has turned it: they face the way the new leg does.
      { x: 100, y: 220, facing: 'left' },
      { x: 60, y: 220, facing: 'left' },
    ])
  })

  it('never doubles anyone up where the path doubles back: nobody stands behind the person in front', () => {
    // Out and back half a body behind: the way back is already taken, all the way along it.
    const queue = coffeeQueue([leg(0, 0), leg(200, 0), leg(200, 30), leg(0, 30)], 12)

    for (const [i, one] of queue.entries()) {
      for (const other of queue.slice(i + 1)) expect(spotsClash(one, other)).toBe(false)
    }
    expect(queue.map((spot) => spot.y)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('stops at the count the corner needs, however long the path is', () => {
    expect(coffeeQueue([leg(0, 0), leg(1000, 0)], 4)).toHaveLength(4)
    expect(coffeeQueue([leg(0, 0), leg(1000, 0)], 0)).toEqual([])
  })

  it('gives back the places a path too short for the count does hold, rather than doubling up', () => {
    expect(coffeeQueue([leg(0, 0), leg(80, 0)], 9)).toHaveLength(3)
  })

  it('stands everyone on a whole painting pixel', () => {
    const queue = coffeeQueue([leg(0, 0), leg(301, 97)], 5)

    for (const spot of queue) {
      expect(Number.isInteger(spot.x), `${spot.x}`).toBe(true)
      expect(Number.isInteger(spot.y), `${spot.y}`).toBe(true)
    }
  })
})
