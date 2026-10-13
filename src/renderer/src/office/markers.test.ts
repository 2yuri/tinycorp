import { describe, expect, it } from 'vitest'
import { PLUMBOB, plumbobPose } from '../../../shared/office/plumbob'
import { sliceSheet } from '../sprites'
import { BUBBLE_COLUMN, bubbleParts, EMERALD_STEPS, frameRows, type RowSpan, turnStep } from './markers'
import { readOfficeSheet } from './testing'

/** The marker sheet the app loads, sliced exactly as the stage slices it. */
function markerSheet() {
  const { rgba, width, height } = readOfficeSheet('office-marker-sheet.png')
  return sliceSheet(rgba, width, height, { greenSubject: true })
}

/** The emerald's three steps, widest first. */
const emeraldWidths = () => markerSheet()[0]!.map((box) => box?.w ?? 0)

describe('the marker sheet', () => {
  it('holds every frame the stage asks it for: three steps of the turn, three bubbles', () => {
    const rows = markerSheet()

    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.filter((box) => box !== null)).toHaveLength(3)
  })

  it('draws the emerald from face on down to a sliver, each step narrower than the last', () => {
    const widths = emeraldWidths()

    expect(widths).toHaveLength(EMERALD_STEPS)
    for (const [step, width] of widths.entries()) if (step > 0) expect(width).toBeLessThan(widths[step - 1]!)
  })

  it('draws the three bubbles alike: one shape in three colours, side by side', () => {
    const bubbles = markerSheet()[1]!.map((box) => box!)

    // The same drawing three times over, so a pixel of anti-aliasing is all that may differ.
    for (const bubble of bubbles) {
      expect(bubble.w).toBeCloseTo(bubbles[0]!.w, -1)
      expect(bubble.h).toBeCloseTo(bubbles[0]!.h, -1)
    }
  })
})

describe('the turn', () => {
  it('picks the widest step face on and the sliver edge on', () => {
    const widths = emeraldWidths()

    expect(turnStep(1, widths)).toBe(0)
    expect(turnStep(-1, widths)).toBe(0)
    expect(turnStep(PLUMBOB.minTurn, widths)).toBe(widths.length - 1)
    expect(turnStep(-PLUMBOB.minTurn, widths)).toBe(widths.length - 1)
  })

  it('never asks for a step the sheet has not got, over a whole turn', () => {
    const widths = emeraldWidths()

    const steps = Array.from({ length: 200 }, (_, at) => turnStep(plumbobPose(40, at * 21).turn, widths))

    expect(Math.min(...steps)).toBe(0)
    expect(Math.max(...steps)).toBe(widths.length - 1)
  })
})

describe('the colour a glyph is drawn in', () => {
  it('keeps the meaning the floor already had: the boss’s call loud, the waiting ones quiet', () => {
    // The sheet paints the bubbles amber, blue-grey, red, in that order.
    expect(BUBBLE_COLUMN['…']).toBe(0)
    expect(BUBBLE_COLUMN['?']).toBe(1)
    expect(BUBBLE_COLUMN.Zzz).toBe(1)
    expect(BUBBLE_COLUMN['!']).toBe(2)
  })
})

describe('a bubble', () => {
  /** A box `w` wide over a tail `tailW` wide at `tailX`, as the sheet draws one. */
  const drawn = (w: number, h: number, tailX: number, tailW: number, tailH: number): (RowSpan | null)[] => [
    ...Array.from({ length: h }, () => ({ left: 0, right: w - 1 })),
    ...Array.from({ length: tailH }, () => ({ left: tailX, right: tailX + tailW - 1 })),
  ]

  it('is the rounded box down to where the tail narrows, and the tail tip lands on the head', () => {
    expect(bubbleParts(drawn(100, 60, 10, 20, 15))).toEqual({
      body: { x: 0, y: 0, w: 100, h: 60 },
      tip: { x: 20, y: 74 },
    })
  })

  it('leaves the glyph in the box, clear of the tail under it', () => {
    const { body, tip } = bubbleParts(drawn(100, 60, 10, 20, 15))

    expect(body.y + body.h).toBeLessThanOrEqual(tip.y)
  })

  it('reads the sheet’s own bubbles as a box with a tail on its left', () => {
    const { rgba, width, height } = readOfficeSheet('office-marker-sheet.png')
    const boxes = sliceSheet(rgba, width, height)[1]!

    for (const box of boxes) {
      const { body, tip } = bubbleParts(frameRows(rgba, width, box!))

      // The box is most of the drawing, and the tail hangs under it towards its left-hand end.
      expect(body.h).toBeGreaterThan(box!.h / 2)
      expect(tip.y).toBe(box!.h - 1)
      expect(tip.x).toBeLessThan(body.x + body.w / 2)
    }
  })
})
