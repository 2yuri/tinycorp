import { describe, expect, it } from 'vitest'
import {
  DOOR_CLOSE_MS,
  DOOR_REACH,
  DOOR_SLIDE_MS,
  type DoorPresence,
  type DoorStates,
  doorDepth,
  doorPanels,
  doorState,
  doorWalls,
} from './doors'
import { PAINTED_ROOM } from './painted-room'

const GLASS = PAINTED_ROOM.walls.find((wall) => wall.name === 'meeting-glass')!
const GAP = GLASS.door!
/** The middle of the door gap, and a spot far away from it. */
const IN_THE_GAP = { x: (GAP.from.x + GAP.to.x) / 2, y: (GAP.from.y + GAP.to.y) / 2 }
const AT_A_DESK = { x: 98, y: 440 }

/** `away` px straight out from the middle of the gap, on the office side. */
function offTheGap(away: number): DoorPresence {
  const length = Math.hypot(GAP.to.x - GAP.from.x, GAP.to.y - GAP.from.y)
  return {
    x: IN_THE_GAP.x - ((GAP.to.y - GAP.from.y) / length) * away,
    y: IN_THE_GAP.y + ((GAP.to.x - GAP.from.x) / length) * away,
  }
}

/** Runs `doorState` frame by frame from shut, `step` ms apart, and returns the glass door each frame. */
function frames(
  who: (frame: number) => DoorPresence[],
  count: number,
  step = 60,
  start = 10_000,
): { open: number; at: number }[] {
  let states: DoorStates = {}
  const out: { open: number; at: number }[] = []
  for (let frame = 0; frame < count; frame++) {
    const now = start + frame * step
    states = doorState(who(frame), now, states)
    out.push({ open: states['meeting-glass']!.open, at: now })
  }
  return out
}

describe('doorWalls', () => {
  it('is the glass front alone: the painting draws no way into the kitchen', () => {
    expect(doorWalls().map((wall) => wall.name)).toEqual(['meeting-glass'])
  })
})

describe('doorState', () => {
  it('leaves the door shut while everybody is at their desk', () => {
    const shut = frames(() => [AT_A_DESK], 20)

    expect(shut.every((frame) => frame.open === 0)).toBe(true)
  })

  it('opens as a character comes within reach of the gap, and is fully open before it arrives', () => {
    const opening = frames(() => [offTheGap(DOOR_REACH - 4)], 8)

    expect(opening[0]!.open).toBe(0)
    expect(opening[1]!.open).toBeGreaterThan(0)
    expect(opening.map((f) => f.open)).toEqual([...opening.map((f) => f.open)].sort((a, b) => a - b))
    expect(opening.at(-1)!.open).toBe(1)
  })

  it('ignores a character just outside reach', () => {
    expect(frames(() => [offTheGap(DOOR_REACH + 4)], 10).every((frame) => frame.open === 0)).toBe(true)
  })

  it('stays open while someone stands in the gap, however long', () => {
    const held = frames(() => [IN_THE_GAP], 60)

    expect(held.at(-1)!.open).toBe(1)
    expect(held.slice(10).every((frame) => frame.open === 1)).toBe(true)
  })

  it('closes only after the delay once the last character is through', () => {
    // Two go in; the second leaves reach at frame 20.
    const leaves = (frame: number) => (frame < 10 ? [IN_THE_GAP, IN_THE_GAP] : frame < 20 ? [IN_THE_GAP] : [AT_A_DESK])
    const run = frames(leaves, 40)
    const left = run[20]!.at
    const stillOpen = run.filter((frame) => frame.at < left + DOOR_CLOSE_MS && frame.at >= left)

    expect(run[19]!.open).toBe(1)
    expect(stillOpen.every((frame) => frame.open === 1)).toBe(true)
    expect(run.find((frame) => frame.at >= left + DOOR_CLOSE_MS + DOOR_SLIDE_MS)!.open).toBe(0)
  })

  it('starts every door shut and settled when there is no state to carry over', () => {
    const fresh = doorState([AT_A_DESK], 5_000)

    expect(fresh['meeting-glass']).toEqual({ open: 0, at: 5_000, freeSince: 5_000 - DOOR_CLOSE_MS })
  })
})

describe('doorPanels', () => {
  it('covers the gap with two panels when shut, each standing on the wall', () => {
    const [left, right] = doorPanels(GLASS)

    expect(left.shut[3]).toEqual(GAP.from)
    expect(right.shut[2]).toEqual(GAP.to)
    // They meet in the middle of the gap.
    expect(left.shut[2]).toEqual(right.shut[3])
    for (const panel of [left, right]) {
      expect(panel.shut[0]!.y).toBe(panel.shut[3]!.y - GLASS.height)
      expect(panel.shut[1]!.y).toBe(panel.shut[2]!.y - GLASS.height)
    }
  })

  it('slides each panel its own half-width out of the gap, in opposite directions', () => {
    const [left, right] = doorPanels(GLASS)
    const half = { x: (GAP.to.x - GAP.from.x) / 2, y: (GAP.to.y - GAP.from.y) / 2 }

    expect(right.slide).toEqual(half)
    expect(left.slide).toEqual({ x: -half.x, y: -half.y })
    // Fully open, neither panel is left over the gap.
    expect(left.shut[2]!.x + left.slide.x).toBeLessThanOrEqual(GAP.from.x)
    expect(right.shut[3]!.x + right.slide.x).toBeGreaterThanOrEqual(GAP.to.x)
  })
})

describe('doorDepth', () => {
  it('is the bottom of the gap, so whoever is outside it passes in front and whoever is inside is behind', () => {
    expect(doorDepth(GLASS)).toBe(GAP.to.y)
  })
})
