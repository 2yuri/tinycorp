import { describe, expect, it } from 'vitest'
import { usageLevel } from './provider-usage'

/**
 * One rule for how full a window reads. The daily digest's meters warmed at half a window and the
 * Accounts card's stayed indigo to the last percent, so frame `bB6VX`'s amber 68% bar came out
 * violet — two thresholds where the frames draw one (T196).
 */
describe('how full a window reads', () => {
  it('is low until half the window is gone', () => {
    expect(usageLevel(0)).toBe('low')
    expect(usageLevel(49)).toBe('low')
  })

  it('warms from half', () => {
    expect(usageLevel(50)).toBe('high')
    expect(usageLevel(68)).toBe('high')
    expect(usageLevel(79)).toBe('high')
  })

  it('is full from four fifths', () => {
    expect(usageLevel(80)).toBe('full')
    expect(usageLevel(100)).toBe('full')
  })
})
