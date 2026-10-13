/**
 * The floor's words are set the way both floor-label frames set every Tag (T156): bold, with a navy
 * outline 1.5 px all round — which a stroke 3 px wide centred on the glyph's edge is.
 */
import { describe, expect, it } from 'vitest'
import { FLOOR_TEXT_STYLE } from './floor-text'

describe('the floor’s type', () => {
  it('is bold, as every floor Tag in the frames is', () => {
    expect(FLOOR_TEXT_STYLE.fontWeight).toBe('700')
  })

  it('is outlined in the frames’ navy, 1.5 px all round, and carries no soft shadow the frames dropped', () => {
    expect(FLOOR_TEXT_STYLE.stroke).toEqual({ color: 0x0b1220, width: 3, join: 'round' })
    expect('dropShadow' in FLOOR_TEXT_STYLE).toBe(false)
  })
})
