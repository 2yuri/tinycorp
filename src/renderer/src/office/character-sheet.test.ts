/**
 * The office character sheet, cell by cell, against the third thing T103 holds the rooms to: a
 * sitter reads the same size as their neighbours. The two seated-from-the-front columns are
 * assembled by `tools/append_front.py`, which scales each row's front art to that row's own
 * seated-from-behind cell and stands it on the same baseline — so a sitter at a chair on the far
 * side of a run is the same person, at the same size, as the one with their back to us beside them.
 * A sheet rebuilt from art that was never scaled drew those two cells a head taller and spilling
 * over the gutter, which is what this reads off the PNG the app actually loads.
 */
import { describe, expect, it } from 'vitest'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { type Box, sliceSheet } from '../sprites'
import { readOfficeSheet } from './testing'

/** The columns of `characters.png` (see `characters.ts`). */
const SEATED_BEHIND = [1, 2]
const SEATED_FRONT = [4, 5]
/** The walk cycle, the reading poses and the hand up: drawn for the rows whose sheets exist. */
const COLUMNS = 18
/** Seated with a hand up: only the looks drawn one character to a sheet have it. */
const WAITING = [14, 15, 16, 17]

/** What the two poses may differ by, in sheet pixels: half of one painting pixel at the office scale. */
const TOLERANCE = 14

function cells(name: string): (Box | null)[][] {
  const { rgba, width, height } = readOfficeSheet(name)
  return sliceSheet(rgba, width, height)
}

describe('characters.png', () => {
  const rows = cells('characters.png')

  it('draws every look the app counts, each in the six poses the office always needs', () => {
    // Read off the PNG rather than trusted: a sheet rebuilt with a row too few or too many, or one
    // saved without its gutters, leaves `CHARACTER_SHEETS` pointing at a look that is not drawn.
    expect(rows).toHaveLength(CHARACTER_SHEETS)
    for (const [i, row] of rows.entries()) {
      expect(row.length, `row ${i}`).toBe(COLUMNS)
      // The first six are the poses every Employee is drawn in; the walk cycle and the reading
      // columns are filled a sheet at a time, and a row without them falls back (see `characters.ts`).
      for (let column = 0; column < 6; column++) expect(row[column], `row ${i}, column ${column}`).not.toBeNull()
    }
  })

  it('gives a look all four hand-up cells or none, so none of them half-waits', () => {
    // A row with some of the four would draw a waiting Employee facing one way and sitting the
    // other. `waitingFrames` takes all four or nothing, and this holds the sheet to the same rule.
    const drawn = rows.filter((row) => WAITING.some((column) => row[column] !== null))
    expect(drawn.length, 'no look carries the hand-up pose').toBeGreaterThan(0)
    for (const row of drawn) {
      for (const column of WAITING) expect(row[column], `row ${rows.indexOf(row)}, column ${column}`).not.toBeNull()
    }
  })

  it('draws every one of them seated from the front, so no far chair falls back to standing', () => {
    for (const [i, row] of rows.entries()) {
      for (const column of SEATED_FRONT) expect(row[column], `row ${i}, column ${column}`).not.toBeNull()
    }
  })

  it('scales the seated-from-the-front cells to the row’s own seated height', () => {
    for (const [i, row] of rows.entries()) {
      const seated = SEATED_BEHIND.map((column) => row[column]!.h)
      const tallest = Math.max(...seated)
      for (const column of SEATED_FRONT) {
        const front = row[column]!
        expect(
          Math.abs(front.h - tallest),
          `row ${i}, column ${column}: ${front.h} against ${tallest}`,
        ).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  })

  it('stands every pose of a row on the same baseline, inside its own cell', () => {
    const cellHeight = Math.round(readOfficeSheet('characters.png').height / rows.length)
    for (const [i, row] of rows.entries()) {
      const drawn = row.map((cell, column) => ({ cell, column })).filter((one) => one.cell !== null)
      const lowest = Math.max(...drawn.map((one) => one.cell!.y + one.cell!.h))
      for (const { cell, column } of drawn) {
        expect(lowest - (cell!.y + cell!.h), `row ${i}, column ${column} floats off the baseline`).toBeLessThanOrEqual(
          TOLERANCE,
        )
        // A cell that spills over its gutter is art that was pasted without being scaled to fit.
        expect(cell!.y, `row ${i}, column ${column} spills over the gutter above it`).toBeGreaterThan(i * cellHeight)
        expect(cell!.y + cell!.h, `row ${i}, column ${column} spills over the gutter below it`).toBeLessThan(
          (i + 1) * cellHeight,
        )
      }
    }
  })
})
