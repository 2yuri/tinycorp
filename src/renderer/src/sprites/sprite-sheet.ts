import { keyOutGreen, keyOutGreenScreen } from './chroma-key'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What splits a sheet's cells. `lines` is the dark green drawn on the chroma: the character sheets
 * and the marker sheet, whose drawings stand clear of the cell's edge. `chroma` is a band of the
 * chroma itself: the floor sheet, whose swatches run to their cell's every edge — and so to the
 * sheet's own — leaving no room for a line around them.
 */
export type SheetGutter = 'lines' | 'chroma'

export interface SheetStyle {
  /** What splits the cells; `lines` when the sheet does not say. */
  gutter?: SheetGutter
  /**
   * The drawing is itself green, so the key may only take the screen away and must leave every other
   * green alone: the emerald of the marker sheet. `false` when the sheet does not say.
   */
  greenSubject?: boolean
}

/** A chroma-green pixel of the sheet's dark gutter lines. */
function gutter(rgba: Uint8ClampedArray, i: number): boolean {
  const r = rgba[i]!
  const g = rgba[i + 1]!
  const b = rgba[i + 2]!
  return g > 80 && g < 200 && r < 80 && b < 80
}

/** A pixel of the bright chroma the sheet is painted on, which `keyOutGreen` takes away. */
function chroma(rgba: Uint8ClampedArray, i: number): boolean {
  const r = rgba[i]!
  const g = rgba[i + 1]!
  const b = rgba[i + 2]!
  return g > 150 && g > Math.max(r, b) * 2
}

/** Cell spans between the dark gutter lines that cross the whole sheet along one axis. */
function spans(length: number, isLine: (at: number) => boolean): [number, number][] {
  const found: [number, number][] = []
  let start = 0
  for (let at = 0; at <= length; at++) {
    const line = at === length || isLine(at)
    if (line && at > start) found.push([start, at])
    if (line) start = at + 1
  }
  // Leftovers a few pixels wide are anti-aliased edges of a gutter, not cells.
  return found.filter(([a, b]) => b - a > 8)
}

/**
 * Slices a green-chroma sheet whose cells are separated by gutters, then keys out the green in place.
 * Returns, row by row, the box of each cell's drawing (its non-transparent pixels), or null when empty.
 */
export function sliceSheet(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  style: SheetStyle = {},
): (Box | null)[][] {
  const isGutter = style.gutter === 'chroma' ? chroma : gutter
  const lineShare = 0.8
  const columns = spans(width, (x) => {
    let hits = 0
    for (let y = 0; y < height; y++) if (isGutter(rgba, (y * width + x) * 4)) hits++
    return hits > height * lineShare
  })
  const rows = spans(height, (y) => {
    let hits = 0
    for (let x = 0; x < width; x++) if (isGutter(rgba, (y * width + x) * 4)) hits++
    return hits > width * lineShare
  })
  if (style.greenSubject) keyOutGreenScreen(rgba, width)
  else keyOutGreen(rgba)
  return rows.map(([top, bottom]) =>
    columns.map(([left, right]) => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -1
      let maxY = -1
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (rgba[(y * width + x) * 4 + 3]! === 0) continue
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
      return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    }),
  )
}
