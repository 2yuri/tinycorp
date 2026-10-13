import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  blurImage,
  cropImage,
  DIFF_BLUR,
  DIFF_FLOOR,
  DIFF_THRESHOLD,
  DIFF_TOLERANCE,
  decodePng,
  diffScore,
  displayP3ToSrgb,
  formatScore,
  type Image,
} from '../tools/design-diff.mjs'

/**
 * The number `pnpm design:compare` prints beside every pair.
 *
 * A sheet read by eye passes a screen that is 1px out of place — twice, in T178 and T181 — so the
 * audit measures instead. These are the tests that would catch a score that lies: one that says
 * two images match when a pixel differs, one that counts the wrong denominator, and one that
 * reads a PNG's rows wrong and calls the noise drift.
 *
 * `sharp` is the measure with its forgivenesses turned off, which is how the counting itself is
 * pinned; everything under "what the measure forgives" runs it as the audit does.
 */

/** The measure with nothing forgiven: one pixel, against the one at the same place. */
const sharp = { blur: 0, tolerance: 0 } as const

function image(width: number, height: number, fill: [number, number, number]): Image {
  const pixels = new Uint8Array(width * height * 4)
  for (let at = 0; at < pixels.length; at += 4) {
    pixels[at] = fill[0]
    pixels[at + 1] = fill[1]
    pixels[at + 2] = fill[2]
    pixels[at + 3] = 255
  }
  return { width, height, pixels }
}

function paint(target: Image, x: number, y: number, colour: [number, number, number]): Image {
  const at = (y * target.width + x) * 4
  target.pixels[at] = colour[0]
  target.pixels[at + 1] = colour[1]
  target.pixels[at + 2] = colour[2]
  return target
}

const SLATE: [number, number, number] = [15, 23, 42]
const INDIGO: [number, number, number] = [99, 102, 241]
const CARD: [number, number, number] = [30, 41, 59]
const INK: [number, number, number] = [226, 232, 240]
const MUTED: [number, number, number] = [148, 163, 184]
const TEAL: [number, number, number] = [45, 212, 191]

interface TextLine {
  x: number
  y: number
  width: number
  height: number
  colour: [number, number, number]
}

function fill(
  target: Image,
  rect: { x: number; y: number; width: number; height: number },
  colour: [number, number, number],
) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) paint(target, x, y, colour)
  }
  return target
}

describe('the diff score', () => {
  it('is zero for two identical images', () => {
    expect(diffScore(image(40, 25, SLATE), image(40, 25, SLATE))).toBe(0)
    expect(diffScore(image(40, 25, SLATE), image(40, 25, SLATE), sharp)).toBe(0)
  })

  it('is the share of the pixels that differ, exactly', () => {
    const changed = paint(image(40, 25, SLATE), 12, 7, INDIGO)

    // One pixel in 40x25 = 1/1000.
    expect(diffScore(image(40, 25, SLATE), changed, sharp)).toBe(0.1)
  })

  it('counts a pixel once however many of its channels moved', () => {
    const red = paint(image(10, 10, SLATE), 0, 0, [200, 23, 42])
    const all = paint(image(10, 10, SLATE), 0, 0, INDIGO)

    expect(diffScore(image(10, 10, SLATE), red, sharp)).toBe(1)
    expect(diffScore(image(10, 10, SLATE), all, sharp)).toBe(1)
  })

  /** Pen's exporter and Chromium disagree on the edge of every glyph; that is not drift. */
  it('lets a channel drift up to the threshold, and no further', () => {
    const inside = paint(image(10, 10, SLATE), 3, 3, [15, 23 + DIFF_THRESHOLD, 42])
    const outside = paint(image(10, 10, SLATE), 3, 3, [15, 23 + DIFF_THRESHOLD + 1, 42])

    expect(diffScore(image(10, 10, SLATE), inside, sharp)).toBe(0)
    expect(diffScore(image(10, 10, SLATE), outside, sharp)).toBe(1)
  })

  /**
   * The two rasterisers move a glyph by up to a pixel on their own, so the audit measures with a
   * pixel of slack. What it buys, and what it costs, are both here.
   */
  it('forgives a pixel that moved one step, and reports one that moved two', () => {
    const line = (x: number) => {
      const target = image(10, 10, SLATE)
      for (let y = 2; y < 8; y++) paint(target, x, y, INDIGO)
      return target
    }

    expect(diffScore(line(4), line(5), { blur: 0, tolerance: DIFF_TOLERANCE })).toBe(0)
    expect(diffScore(line(4), line(6), { blur: 0, tolerance: DIFF_TOLERANCE })).toBeGreaterThan(0)
    // Without the slack the same one-pixel step is twelve pixels of 'drift'.
    expect(diffScore(line(4), line(5), sharp)).toBe(12)
  })

  it('refuses two images of different sizes rather than comparing a corner of each', () => {
    expect(() => diffScore(image(10, 10, SLATE), image(10, 9, SLATE))).toThrow('cannot compare 10x10 with 10x9')
  })

  it('prints a score the same way every time', () => {
    expect(formatScore(0)).toBe('0.00%')
    expect(formatScore(1.239)).toBe('1.24%')
  })
})

/**
 * What the measure forgives, and what it must not (T200).
 *
 * The audit's floor is a share of a pair's pixels, so a measure that spends that share on the two
 * rasterisers' disagreement has none left for drift: T196 measured a correctly placed column of
 * body text at 2–8% on its own. These are the five fixtures the new measure is held to — the
 * first two are what it has to forgive, the last three are what it still has to catch.
 */
describe('what the measure forgives', () => {
  /**
   * A little screen: a heading, two lines of body, and a button on a card.
   *
   * The lines are drawn as stems — 2px of ink every 6px, which is about the rhythm of this app's
   * 13px type — rather than as solid bars. A bar has two vertical edges and a line of text has one
   * per stem, so a screen made of bars would be a screen a shift barely shows up in.
   */
  function line(screen: Image, { x, y, width, height, colour }: TextLine) {
    for (let stem = 0; stem + 2 <= width; stem += 6) {
      fill(screen, { x: x + stem, y, width: 2, height }, colour)
    }
  }

  function panel({ shift = 0, button = INDIGO as [number, number, number] | null } = {}) {
    const screen = image(200, 120, SLATE)
    fill(screen, { x: 10, y: 10, width: 180, height: 100 }, CARD)
    line(screen, { x: 22 + shift, y: 24, width: 96, height: 9, colour: INK })
    for (const y of [46, 60]) line(screen, { x: 22 + shift, y, width: 152, height: 6, colour: MUTED })
    if (button) fill(screen, { x: 22 + shift, y: 80, width: 72, height: 22 }, button)
    return screen
  }

  it('is zero for a pair that is the same picture', () => {
    expect(diffScore(panel(), panel())).toBe(0)
  })

  /**
   * The evidence the measure exists for, and the only fixture here that is not drawn by this file:
   * 240x56 of the Environments tab's `Each env_run with prod waits…` paragraph, cut out of the
   * audit's own shot and out of frame `zpvHQ` at the same place. Every letter starts and ends on
   * the same pixel in both — Pen's rasteriser and Chromium just draw it differently.
   */
  it('reads the same paragraph from two rasterisers as a match', () => {
    const app = decodePng(readFileSync(join(import.meta.dirname, 'design-diff-fixtures', 'paragraph-app.png')))
    const frame = decodePng(readFileSync(join(import.meta.dirname, 'design-diff-fixtures', 'paragraph-frame.png')))

    // 10.38% of the box, pixel against pixel, for text that is exactly where it belongs.
    expect(diffScore(app, frame, sharp)).toBeGreaterThan(10)
    expect(diffScore(app, frame)).toBeLessThan(0.5)
  })

  it('forgives a screen whose content sits one pixel over, and reports one two pixels over', () => {
    // A pixel is as far as the two rasterisers move a line on their own, so a pixel is free.
    expect(diffScore(panel(), panel({ shift: 1 }))).toBe(0)
    expect(diffScore(panel(), panel({ shift: 2 }))).toBeGreaterThan(DIFF_FLOOR)
  })

  it('still reports a button the screen does not draw', () => {
    expect(diffScore(panel(), panel({ button: null }))).toBeGreaterThan(DIFF_FLOOR)
  })

  it('still reports a button drawn in the wrong colour', () => {
    expect(diffScore(panel(), panel({ button: TEAL }))).toBeGreaterThan(DIFF_FLOOR)
  })
})

describe('the neighbourhood mean', () => {
  it('leaves a flat image alone', () => {
    expect([...blurImage(image(8, 8, INDIGO), DIFF_BLUR).pixels.subarray(0, 4)]).toEqual([...INDIGO, 255])
  })

  it('spreads one pixel over the square around it, and no further', () => {
    const dot = paint(image(9, 9, [0, 0, 0]), 4, 4, [250, 250, 250])

    const soft = blurImage(dot, 1)

    // 250 over the 3x3 it was averaged with; the ring outside that never saw it.
    expect(soft.pixels[(4 * 9 + 4) * 4]).toBe(Math.round(250 / 9))
    expect(soft.pixels[(4 * 9 + 3) * 4]).toBe(Math.round(250 / 9))
    expect(soft.pixels[(4 * 9 + 2) * 4]).toBe(0)
  })

  it('keeps the alpha it was given rather than averaging it', () => {
    const edges = image(4, 4, INDIGO)
    edges.pixels[3] = 0

    expect(blurImage(edges, DIFF_BLUR).pixels[3]).toBe(0)
  })
})

describe('the crop that makes a pair comparable', () => {
  it('takes the rectangle asked for, and its pixels', () => {
    const source = paint(image(8, 6, SLATE), 5, 4, INDIGO)

    const cropped = cropImage(source, { x: 4, y: 3, width: 4, height: 3 })

    expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 4, height: 3 })
    // The painted pixel was at (5,4) in the source, which is (1,1) in the crop.
    const painted = (1 * cropped.width + 1) * 4
    expect([...cropped.pixels.subarray(painted, painted + 4)]).toEqual([...INDIGO, 255])
  })

  it('refuses a rectangle that runs off the image', () => {
    expect(() => cropImage(image(8, 6, SLATE), { x: 4, y: 3, width: 6, height: 3 })).toThrow('falls outside 8x6')
  })
})

describe('reading a PNG', () => {
  /**
   * A 4x4 ramp from black to white, written with a different row filter on each row — none, Sub,
   * Up and Paeth. A decoder that gets one of them wrong reads a plausible-looking picture, so this
   * is checked against a file with known bytes rather than against something it encoded itself.
   */
  const ramp = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAIklEQVR4nGNgYGAQFBRUUlIyNjZmdHFxEYQBJhckwIIsAwCuFQc0PeZtlQAAAABJRU5ErkJggg==',
    'base64',
  )

  it('gives back the pixels the file holds, row by row', () => {
    const decoded = decodePng(ramp)

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 4, height: 4 })
    expect([...decoded.pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...decoded.pixels.subarray(15 * 4, 16 * 4)]).toEqual([255, 255, 255, 255])
  })

  it('says so rather than guessing when the file is a kind it does not read', () => {
    const palette = Buffer.from(ramp)
    palette[25] = 3

    expect(() => decodePng(palette)).toThrow('only 8-bit RGB(A) is read')
  })
})

describe('Display-P3 read as sRGB', () => {
  /**
   * Both spaces are the same numbers at their ends and around the greys, and differ in between:
   * a saturated P3 green is outside sRGB, so it comes back clipped and much brighter in red.
   */
  it('leaves black, white and grey where they are', () => {
    const greys = displayP3ToSrgb(image(1, 3, [0, 0, 0]))

    expect([...greys.pixels.subarray(0, 3)]).toEqual([0, 0, 0])
    expect([...displayP3ToSrgb(image(1, 1, [255, 255, 255])).pixels.subarray(0, 3)]).toEqual([255, 255, 255])
    expect([...displayP3ToSrgb(image(1, 1, [128, 128, 128])).pixels.subarray(0, 3)]).toEqual([128, 128, 128])
  })

  it('pulls a saturated colour out to where sRGB draws the same light', () => {
    // The kit's indigo, and the kit's green, as a P3 capture would have written them.
    expect([...displayP3ToSrgb(image(1, 1, [99, 102, 241])).pixels.subarray(0, 3)]).toEqual([98, 102, 250])
    expect([...displayP3ToSrgb(image(1, 1, [34, 197, 94])).pixels.subarray(0, 3)]).toEqual([0, 201, 79])
  })

  it('keeps the alpha channel it was given', () => {
    const translucent = image(1, 1, [99, 102, 241])
    translucent.pixels[3] = 128

    expect(displayP3ToSrgb(translucent).pixels[3]).toBe(128)
  })
})
