import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { walkCycle } from './characters'

/** A row of the sheet: whatever columns it happens to carry. */
const row = (count: number, filled: number[]) =>
  Array.from({ length: count }, (_, i) => (filled.includes(i) ? ({ label: i } as unknown as Texture) : Texture.EMPTY))

describe('the frames a character walks on', () => {
  it('uses the cycle when the sheet carries one', () => {
    expect(walkCycle(row(10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toHaveLength(4)
  })

  it('falls back to the one walking frame the sheet has always had', () => {
    const only = walkCycle(row(6, [0, 1, 2, 3, 4, 5]))

    expect(only).toHaveLength(1)
    expect(only[0]).toEqual({ label: 3 })
  })

  it('ignores a half-drawn cycle: one extra frame is not a walk', () => {
    expect(walkCycle(row(7, [0, 1, 2, 3, 4, 5, 6]))).toHaveLength(1)
  })
})
