import { describe, expect, it } from 'vitest'
import { keyOutGreen, keyOutGreenScreen } from './chroma-key'

describe('keyOutGreen', () => {
  it('clears chroma green and keeps the character, taking the green spill off its edges', () => {
    const pixels = new Uint8ClampedArray([
      0,
      255,
      0,
      255, // chroma
      40,
      200,
      60,
      255, // darker chroma
      200,
      160,
      120,
      255, // skin
      30,
      40,
      60,
      255, // dark hair
      90,
      130,
      90,
      255, // green-tinted edge
    ])

    keyOutGreen(pixels)

    expect([...pixels]).toEqual([0, 255, 0, 0, 40, 200, 60, 0, 200, 160, 120, 255, 30, 40, 60, 255, 90, 90, 90, 255])
  })
})

describe('keyOutGreenScreen', () => {
  const SCREEN = [11, 244, 1]
  const GUTTER = [5, 160, 5]
  /** The emerald's dark facet: as much green as the gutter, but with real blue in it. */
  const FACET = [3, 160, 68]

  /** A 5x5 of the screen with a 3x3 of `drawing` in the middle of it, `middle` at its very centre. */
  function patch(drawing: number[], middle: number[]): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(25 * 4)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const inside = x > 0 && x < 4 && y > 0 && y < 4
        const colour = x === 2 && y === 2 ? middle : inside ? drawing : SCREEN
        pixels.set([...colour, 255], (y * 5 + x) * 4)
      }
    }
    return pixels
  }

  const opaque = (pixels: Uint8ClampedArray) =>
    Array.from({ length: 25 }, (_, at) => (pixels[at * 4 + 3] === 0 ? '.' : '#')).join('')
  const colour = (pixels: Uint8ClampedArray, at: number) => [...pixels.slice(at * 4, at * 4 + 3)]
  /** The 3x3 of the drawing, as `patch` lays it out. */
  const DRAWING = '.....' + '.###.' + '.###.' + '.###.' + '.....'

  it('clears the screen and the gutter lines drawn on it', () => {
    const pixels = patch(GUTTER, FACET)

    keyOutGreenScreen(pixels, 5)

    // The gutter is the screen's own hue, so the whole ring goes with it and the facet stays.
    expect(opaque(pixels)).toBe('.'.repeat(12) + '#' + '.'.repeat(12))
  })

  it('leaves a green the drawing owns alone, wherever the screen does not touch it', () => {
    const pixels = patch(FACET, FACET)

    keyOutGreenScreen(pixels, 5)

    expect(opaque(pixels)).toBe(DRAWING)
    expect(colour(pixels, 12)).toEqual(FACET)
  })

  it('takes the spill off the one rim of pixels the screen touches', () => {
    const pixels = patch(FACET, FACET)

    keyOutGreenScreen(pixels, 5)

    // The rim beside the screen is pulled back to the grey under it; the middle keeps its green.
    expect(colour(pixels, 6)).toEqual([3, 68, 68])
    expect(colour(pixels, 12)).toEqual(FACET)
  })
})
