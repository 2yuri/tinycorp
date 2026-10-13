import { describe, expect, it } from 'vitest'
import { iconLetters, notificationIcon } from './notification-icon'

/** The colour at a pixel, as RGB. */
function pixelAt(tile: { width: number; data: Buffer }, x: number, y: number) {
  const at = (y * tile.width + x) * 4
  return [tile.data[at + 2], tile.data[at + 1], tile.data[at], tile.data[at + 3]]
}

describe('the notification icon tile', () => {
  it('draws at most the first two letters the font knows', () => {
    expect(iconLetters('OR')).toEqual(['O', 'R'])
    expect(iconLetters('nv')).toEqual(['N', 'V'])
    expect(iconLetters('!')).toEqual(['!'])
    expect(iconLetters('Ada Lorne')).toEqual(['A', 'D'])
    expect(iconLetters('日本')).toEqual([])
  })

  it('has nothing to draw when the initials are unknown', () => {
    expect(notificationIcon('日本')).toBeNull()
    expect(notificationIcon('')).toBeNull()
  })

  it('is an opaque #334155 tile with #CBD5E1 letters on it', () => {
    const tile = notificationIcon('OR')!

    expect(tile.width).toBe(64)
    expect(tile.height).toBe(64)
    expect(tile.data).toHaveLength(64 * 64 * 4)
    expect(pixelAt(tile, 32, 4)).toEqual([0x33, 0x41, 0x55, 0xff])
    // The corners stay transparent, so the tile reads as rounded.
    expect(pixelAt(tile, 0, 0)).toEqual([0, 0, 0, 0])
    const ink = [...Array(64).keys()].flatMap((y) => [...Array(64).keys()].map((x) => pixelAt(tile, x, y)))
    expect(ink.filter(([r, g, b]) => r === 0xcb && g === 0xd5 && b === 0xe1).length).toBeGreaterThan(100)
  })

  it('draws the budget’s ! in red', () => {
    const tile = notificationIcon('!')!
    const pixels = [...Array(64).keys()].flatMap((y) => [...Array(64).keys()].map((x) => pixelAt(tile, x, y)))
    expect(pixels.some(([r, g, b]) => r === 0xf8 && g === 0x71 && b === 0x71)).toBe(true)
  })
})
