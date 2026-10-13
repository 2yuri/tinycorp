import { describe, expect, it } from 'vitest'
import { PLUMBOB, plumbobBottom, plumbobPose } from './plumbob'

/** A body height in painting pixels for every character the sheet draws, seated and standing. */
const HEIGHTS = [42, 78, 84, 88, 96]
const CLOCKS = Array.from({ length: 400 }, (_, i) => i * 37)

describe('the plumbob', () => {
  it('stays clear above the head at every point of its bob', () => {
    for (const height of HEIGHTS) {
      for (const clock of CLOCKS) {
        expect(plumbobBottom(plumbobPose(height, clock))).toBeLessThanOrEqual(-height - PLUMBOB.gap)
      }
    }
  })

  it('rides exactly as high as the body is tall, so zoom cannot part them', () => {
    // Everything is painting pixels in the sprite's own space: the stage scales both together.
    const low = plumbobPose(60, 0)
    const tall = plumbobPose(90, 0)

    expect(tall.y - low.y).toBe(-30)
  })

  it('bobs a few pixels and no more', () => {
    const heights = CLOCKS.map((clock) => plumbobPose(80, clock).y)
    const swing = Math.max(...heights) - Math.min(...heights)

    expect(swing).toBeGreaterThan(PLUMBOB.bob)
    expect(swing).toBeLessThanOrEqual(2 * PLUMBOB.bob)
  })

  it('turns all the way round without ever vanishing edge-on', () => {
    const turns = CLOCKS.map((clock) => plumbobPose(80, clock).turn)

    expect(Math.min(...turns.map(Math.abs))).toBeGreaterThanOrEqual(PLUMBOB.minTurn)
    expect(Math.max(...turns)).toBeCloseTo(1, 1)
    expect(Math.min(...turns)).toBeCloseTo(-1, 1)
  })

  it('is a function of the clock alone, so frames cannot drift it', () => {
    // One long frame and a hundred short ones covering the same time land on the same pose.
    const jumped = plumbobPose(80, 5000)
    let stepped = plumbobPose(80, 0)
    for (let i = 1; i <= 100; i++) stepped = plumbobPose(80, i * 50)

    expect(stepped).toEqual(jumped)
    expect(plumbobPose(80, 1234)).toEqual(plumbobPose(80, 1234))
  })

  it('comes back round to where it was once both loops have run', () => {
    const period = PLUMBOB.bobMs * PLUMBOB.spinMs
    const later = plumbobPose(80, 700 + period)
    const now = plumbobPose(80, 700)

    expect(later.y).toBeCloseTo(now.y, 6)
    expect(later.turn).toBeCloseTo(now.turn, 6)
  })
})
