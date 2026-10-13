import { describe, expect, it } from 'vitest'
import { sliceSheet } from './sprite-sheet'

const CHROMA = [20, 240, 10, 255]
const GUTTER = [5, 160, 5, 255]
const INK = [60, 40, 30, 255]

/** A 2×2 sheet of uneven cells split by one-pixel gutters, with ink at the given pixels. */
function sheet(width: number, height: number, gutterX: number, gutterY: number, ink: [number, number][]) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = x === gutterX || y === gutterY ? GUTTER : CHROMA
      rgba.set(colour, (y * width + x) * 4)
    }
  }
  for (const [x, y] of ink) rgba.set(INK, (y * width + x) * 4)
  return rgba
}

describe('sliceSheet', () => {
  it('finds each cell between the gutters and boxes its drawing', () => {
    const rgba = sheet(30, 24, 12, 10, [
      [3, 2],
      [5, 8], // row 0, column 0: 3..5 × 2..8
      [20, 4], // row 0, column 1
      [14, 15],
      [15, 22], // row 1, column 1
    ])

    expect(sliceSheet(rgba, 30, 24)).toEqual([
      [
        { x: 3, y: 2, w: 3, h: 7 },
        { x: 20, y: 4, w: 1, h: 1 },
      ],
      [null, { x: 14, y: 15, w: 2, h: 8 }],
    ])
  })

  it('keys the chroma and the gutters out', () => {
    const rgba = sheet(30, 24, 12, 10, [[3, 2]])

    sliceSheet(rgba, 30, 24)

    expect(rgba[(2 * 30 + 3) * 4 + 3]).toBe(255)
    expect(rgba[(0 * 30 + 0) * 4 + 3]).toBe(0)
    expect(rgba[(0 * 30 + 12) * 4 + 3]).toBe(0)
  })

  it('splits on the chroma itself for a sheet whose cells are painted to their every edge', () => {
    const width = 30
    const height = 24
    const rgba = new Uint8ClampedArray(width * height * 4)
    // Two swatches side by side, the chroma showing only in the band between them.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) rgba.set(x >= 10 && x < 20 ? CHROMA : INK, (y * width + x) * 4)
    }

    expect(sliceSheet(rgba, width, height, { gutter: 'chroma' })).toEqual([
      [
        { x: 0, y: 0, w: 10, h: 24 },
        { x: 20, y: 0, w: 10, h: 24 },
      ],
    ])
  })
})
