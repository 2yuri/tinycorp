/** Makes chroma-green RGBA pixels transparent, in place; green spill on the edges is pulled back to grey. */
export function keyOutGreen(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!
    const g = rgba[i + 1]!
    const b = rgba[i + 2]!
    const other = Math.max(r, b)
    if (g > 150 && g > other * 2) rgba[i + 3] = 0
    else if (g > other) rgba[i + 1] = other
  }
}

/**
 * How much blue and red the screen green carries beside its own green, at most: measured off
 * `design/office/office-marker-sheet.png`, whose screen runs to a sixth as much blue as green where
 * it meets a gutter, and whose emerald never goes below a third.
 */
const SCREEN_BLUE = 0.2
const SCREEN_RED = 0.4

/**
 * The key for a sheet whose own drawing is green: the marker sheet's emerald (T98). The screen and
 * its gutter lines are a hue of their own — almost no blue beside the green, and little red — and
 * only that hue goes, because pulling every green back to the grey beside it, which is what keeps a
 * hand from going green, would drain an emerald to slate.
 * The spill is taken off the one rim of pixels that touches the screen, which is where it lands: that
 * is the green fringe round a bubble, and on the diamond it is the outermost pixel of a drawing put
 * on the stage ten times smaller.
 */
export function keyOutGreenScreen(rgba: Uint8ClampedArray, width: number): void {
  const screen = new Uint8Array(rgba.length / 4)
  for (let pixel = 0; pixel < screen.length; pixel++) {
    const r = rgba[pixel * 4]!
    const g = rgba[pixel * 4 + 1]!
    const b = rgba[pixel * 4 + 2]!
    if (g > 60 && b < g * SCREEN_BLUE && r < g * SCREEN_RED) screen[pixel] = 1
  }
  const height = screen.length / width
  for (let pixel = 0; pixel < screen.length; pixel++) {
    if (screen[pixel]) {
      rgba[pixel * 4 + 3] = 0
      continue
    }
    const x = pixel % width
    const y = (pixel - x) / width
    const rim =
      (x > 0 && screen[pixel - 1]) ||
      (x < width - 1 && screen[pixel + 1]) ||
      (y > 0 && screen[pixel - width]) ||
      (y < height - 1 && screen[pixel + width])
    if (!rim) continue
    const other = Math.max(rgba[pixel * 4]!, rgba[pixel * 4 + 2]!)
    if (rgba[pixel * 4 + 1]! > other) rgba[pixel * 4 + 1] = other
  }
}
