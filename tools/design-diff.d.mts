/** Types for `tools/design-diff.mjs`, the pixel half of the design audit. */

/** A decoded image: 8-bit RGBA, row by row, in sRGB. */
export interface Image {
  width: number
  height: number
  pixels: Uint8Array
}

/** A rectangle of an image, in its own pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** How far one channel may drift before the pixel counts as different. */
export const DIFF_THRESHOLD: number

/** How far a pixel may be from where the other image puts it. */
export const DIFF_TOLERANCE: number

/** How far a pixel is averaged with its neighbours before either image is read. */
export const DIFF_BLUR: number

/** The share of a pair's pixels that may differ and still count as matching. */
export const DIFF_FLOOR: number

/** A PNG's pixels, converted to sRGB when the file says it is Display-P3. */
export function decodePng(bytes: Buffer): Image

/** The same colours, read as Display-P3 and written as sRGB. */
export function displayP3ToSrgb(image: Image): Image

/** The rectangle of an image, as an image of its own. */
export function cropImage(image: Image, rect: Rect): Image

/** Each pixel replaced by the mean of the square of `radius` around it, per colour channel. */
export function blurImage(image: Image, radius: number): Image

/** The share of pixels, as a percentage, that differ from the other image beyond the tolerance. */
export function diffScore(
  a: Image,
  b: Image,
  options?: { threshold?: number; tolerance?: number; blur?: number },
): number

/** A score as the sheet prints it. */
export function formatScore(score: number): string
