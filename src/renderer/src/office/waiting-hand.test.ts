import { Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { waitingFrames } from './characters'

/** A row of the sheet: whatever columns it happens to carry. */
const row = (count: number, filled: number[]) =>
  Array.from({ length: count }, (_, i) => (filled.includes(i) ? ({ label: i } as unknown as Texture) : Texture.EMPTY))

const all = Array.from({ length: 18 }, (_, i) => i)

describe('the hand an Employee waiting on the boss puts up', () => {
  it('takes the four cells after reading, in the order the seated poses are in', () => {
    const hand = waitingFrames(row(18, all))

    expect(hand).toEqual([{ label: 14 }, { label: 15 }, { label: 16 }, { label: 17 }])
  })

  it('has nothing for the looks drawn before the pose existed, so they sit instead', () => {
    // Eighteen of the thirty-three looks come from sheets that stop at column 14. They keep the `!`
    // over their head and nothing else changes, which is what the office did before the pose.
    expect(waitingFrames(row(14, all.slice(0, 14)))).toEqual([])
  })

  it('refuses a half-drawn hand: three turns would leave one facing the wrong way', () => {
    expect(waitingFrames(row(18, [...all.slice(0, 14), 14, 15, 16]))).toEqual([])
  })

  it('has nothing for a row that is not there at all', () => {
    expect(waitingFrames(undefined)).toEqual([])
  })
})
