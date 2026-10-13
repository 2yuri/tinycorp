/**
 * Where the label that travels with a sprite lands (T100). It rides under the feet wherever the
 * painting has floor left under them, and is flipped over the head where it does not — the Night
 * Shift's boss chair sits at the frame's edge, and a visitor's label pressed flat against that edge
 * landed on the same line as `Your chair`.
 */
import { describe, expect, it } from 'vitest'
import { AWAY_TAG_DROP, awayTagY, FLOOR_GUTTER, HEAD_GAP } from './away-tag'

const label = 13
const headroom = 40

describe('the travelling label', () => {
  it('rides under the feet while the floor has room for it', () => {
    expect(awayTagY({ feet: 300, floorBottom: 660, label, headroom })).toBe(AWAY_TAG_DROP)
  })

  it('still rides under the feet on the last line the floor can hold the whole label on', () => {
    const feet = 660 - AWAY_TAG_DROP - label - FLOOR_GUTTER
    expect(awayTagY({ feet, floorBottom: 660, label, headroom })).toBe(AWAY_TAG_DROP)
  })

  it('is flipped over the sprite the moment the floor below runs out', () => {
    const feet = 660 - AWAY_TAG_DROP - label - FLOOR_GUTTER + 1
    expect(awayTagY({ feet, floorBottom: 660, label, headroom })).toBe(-headroom - HEAD_GAP - label)
  })

  it('clears whatever already floats over the head: the bubble sets the headroom', () => {
    const feet = 650
    const overBubble = awayTagY({ feet, floorBottom: 660, label, headroom: 70 })
    expect(overBubble).toBeLessThan(awayTagY({ feet, floorBottom: 660, label, headroom: 40 }))
    expect(overBubble).toBe(-70 - HEAD_GAP - label)
  })

  it('never writes below the painting, whichever side of the sprite it is on', () => {
    for (const feet of [100, 300, 600, 640, 655, 660]) {
      const y = awayTagY({ feet, floorBottom: 660, label, headroom })
      expect(feet + y + label, `feet ${feet}`).toBeLessThanOrEqual(660)
    }
  })
})
