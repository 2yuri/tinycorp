/**
 * The pass that keeps two labels off each other (T105): boxes at the same spot come out stacked and
 * clear, in a stable order, and a box with no floor left under it is flipped over its own sprite.
 */
import { describe, expect, it } from 'vitest'
import { type FloorLabel, LABEL_GUTTER, labelsOverlap, layOutLabels } from './label-layout'

const HEIGHT = 13
const FLOOR = { bottom: 660 }

const box = (key: string, x: number, y: number, over: Partial<FloorLabel> = {}): FloorLabel => ({
  key,
  x,
  y,
  width: 60,
  height: HEIGHT,
  ...over,
})

/** Every pair of the laid-out boxes, so a test can say none of them share a pixel. */
function pairs<T>(all: readonly T[]): [T, T][] {
  return all.flatMap((one, i) => all.slice(i + 1).map((two): [T, T] => [one, two]))
}

describe('laying the floor labels out', () => {
  it('leaves a lone label exactly where it asked to sit', () => {
    const [only] = layOutLabels([box('a', 100, 300)], FLOOR)
    expect(only).toMatchObject({ y: 300, flipped: false })
  })

  it('stacks a handful of boxes at the same spot with none of them overlapping', () => {
    const placed = layOutLabels(
      ['a', 'b', 'c', 'd', 'e'].map((key) => box(key, 100, 300)),
      FLOOR,
    )
    for (const [one, two] of pairs(placed)) {
      expect(labelsOverlap(one, two), `${one.key} over ${two.key}`).toBe(false)
    }
    expect(placed.map((one) => one.y)).toEqual([300, 315, 330, 345, 360])
  })

  it('leaves alone two labels whose boxes never meet', () => {
    const placed = layOutLabels([box('a', 100, 300), box('b', 300, 300)], FLOOR)
    expect(placed.map((one) => one.y)).toEqual([300, 300])
  })

  it('moves the lower of two that overlap by a line, and leaves the upper one where it was', () => {
    const placed = layOutLabels([box('low', 100, 306), box('high', 100, 300)], FLOOR)
    expect(placed).toMatchObject([
      { key: 'low', y: 306 + HEIGHT + LABEL_GUTTER },
      { key: 'high', y: 300 },
    ])
    expect(labelsOverlap(placed[0]!, placed[1]!)).toBe(false)
  })

  it('lays the same floor out the same way twice, whatever order it is handed in', () => {
    const labels = ['a', 'b', 'c', 'd'].map((key, i) => box(key, 100 + i, 300))
    const once = layOutLabels(labels, FLOOR)
    const again = layOutLabels([...labels].reverse(), FLOOR)
    const ys = (placed: { key: string; y: number }[]) => Object.fromEntries(placed.map((one) => [one.key, one.y]))
    expect(ys(again)).toEqual(ys(once))
    expect(ys(layOutLabels(labels, FLOOR))).toEqual(ys(once))
  })

  it('does not move a label whose neighbours have not moved', () => {
    const labels = [box('a', 100, 300), box('b', 100, 304), box('c', 400, 500)]
    const before = layOutLabels(labels, FLOOR)
    const after = layOutLabels([labels[0]!, labels[1]!, box('c', 400, 500)], FLOOR)
    expect(after.map((one) => one.y)).toEqual(before.map((one) => one.y))
  })

  it('flips a label over its own sprite when the floor below has run out', () => {
    const placed = layOutLabels([box('sitter', 100, 640), box('stander', 100, 642, { above: 580 })], { bottom: 660 })
    expect(placed[1]).toMatchObject({ key: 'stander', y: 580, flipped: true })
    expect(labelsOverlap(placed[0]!, placed[1]!)).toBe(false)
  })

  it('keeps a label with nowhere to flip to on the last line that held it', () => {
    const placed = layOutLabels([box('sitter', 100, 640), box('stander', 100, 642)], { bottom: 660 })
    expect(placed[1]).toMatchObject({ key: 'stander', y: 642, flipped: false })
  })

  it('climbs a label that is already over its sprite, rather than dropping it back onto the floor', () => {
    const placed = layOutLabels([box('one', 100, 200, { over: true }), box('two', 100, 204, { over: true })], FLOOR)
    expect(placed[1]!.y).toBeLessThan(placed[0]!.y)
    expect(labelsOverlap(placed[0]!, placed[1]!)).toBe(false)
    expect(placed.every((one) => one.flipped)).toBe(true)
  })

  it('moves the people around a line painted with the room, and never the line itself', () => {
    const placed = layOutLabels([box('chair', 100, 300, { fixed: true }), box('visitor', 100, 298)], FLOOR)
    expect(placed[0]).toMatchObject({ key: 'chair', y: 300 })
    expect(labelsOverlap(placed[0]!, placed[1]!)).toBe(false)
    expect(placed[1]!.y).toBeGreaterThan(300)
  })
})
