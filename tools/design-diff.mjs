// The pixel half of `pnpm design:compare`: decode two PNGs and say how far apart they are. Kept
// beside the audit rather than inside it so the number can be tested without starting Electron.
import { inflateSync } from 'node:zlib'

/**
 * How far one channel may drift before the pixel counts as different.
 *
 * Read after {@link DIFF_BLUR}, not off the raw shot: a neighbourhood mean divides an isolated
 * difference by as much as the 25 pixels it averages, so the number that used to be 8/255 on the
 * pixels themselves is 4/255 on their means. What it keeps out is the last of the rasterisers'
 * disagreement; what it still catches is a token one step off, which moves a flat area by 15 or
 * more however far it is blurred.
 */
export const DIFF_THRESHOLD = 4

/**
 * How far a pixel may be from where the other image puts it.
 *
 * One pixel, because that is how far the two rasterisers move a glyph on their own: the same tab
 * row, at the same values, lands its last label 3px further along in Chromium than in Pen's
 * export. A pair is measured against what a person could point at, so drift smaller than the
 * measurement is left out rather than reported.
 */
export const DIFF_TOLERANCE = 1

/**
 * How far a pixel is averaged with its neighbours before either image is read.
 *
 * {@link DIFF_TOLERANCE} forgives a glyph that sits a pixel off. It cannot forgive a glyph that
 * sits in exactly the right place and is *shaped* differently, which is the other half of what
 * Pen's rasteriser and Chromium disagree about — and the half that costs a text-dense pair 2–8%
 * of its pixels for being correct (T196). A stem half a pixel wider is a difference with no
 * neighbourhood behind it: average each pixel with the 5x5 around it and it is gone, because the
 * ink in that neighbourhood is the same ink.
 *
 * A difference with a neighbourhood behind it survives, and that is everything a person would
 * point at. Radius 2 measured on the sheet: three lines of body text whose ink starts and ends on
 * the same pixel in both images go from 10.38% of their box to 0.08%, while the same screen
 * shifted two pixels sideways still scores 3.46% — over {@link DIFF_FLOOR} — and a card whose text
 * wraps one word early goes from 10% to 26%. The measure stopped punishing correct text and
 * started reporting the drift that was hiding inside it. the design audit notes has the table.
 */
export const DIFF_BLUR = 2

/**
 * The share of a pair's pixels that may differ and still count as matching.
 *
 * Read off the sheet rather than chosen, and unchanged by T200. With {@link DIFF_TOLERANCE} taking
 * the rasterisers' disagreement about *where* a glyph sits out and {@link DIFF_BLUR} taking their
 * disagreement about its *shape* out, what a pair still scores is its own drift plus the frames'
 * JPEG-soft artwork: the best pairs measure around 1%. 3% leaves that room and nothing else.
 */
export const DIFF_FLOOR = 3

/**
 * A decoded image: 8-bit RGBA, row by row, in sRGB.
 * @typedef {{ width: number, height: number, pixels: Uint8Array }} Image
 */

/**
 * A PNG's pixels. 8-bit truecolour, with or without alpha, not interlaced — which is what Pen
 * exports and what Electron's `capturePage` writes. Anything else throws rather than being
 * guessed at, because a silently wrong decode reads as drift.
 *
 * A file that says it is Display-P3 is converted to sRGB on the way out, so a capture and a frame
 * are compared in one space. Chromium tags a capture P3 on a wide-gamut display unless it is run
 * with `--force-color-profile=srgb`; the audit's offscreen Electron shots come back untagged sRGB
 * and are left alone.
 *
 * @param {Buffer} bytes
 * @returns {Image}
 */
export function decodePng(bytes) {
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const depth = bytes[24]
  const colour = bytes[25]
  const interlaced = bytes[28]
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlaced !== 0) {
    throw new Error(`png is depth ${depth}, colour type ${colour}, interlace ${interlaced}: only 8-bit RGB(A) is read`)
  }

  const channels = colour === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat(bytes)))
  const pixels = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1)
    unfilter(raw[at], raw.subarray(at + 1, at + 1 + stride), previous, row, channels)
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 4
      pixels[to] = row[from]
      pixels[to + 1] = row[from + 1]
      pixels[to + 2] = row[from + 2]
      pixels[to + 3] = channels === 4 ? row[from + 3] : 255
    }
    const done = previous
    previous = row
    row = done
  }
  const image = { width, height, pixels }
  return isDisplayP3(bytes) ? displayP3ToSrgb(image) : image
}

/** Every IDAT chunk, in order: one PNG's pixel data is split across as many as the writer liked. */
function idat(bytes) {
  const parts = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length))
    if (type === 'IEND') break
    at += 12 + length
  }
  return parts
}

/** Whether a PNG declares Display-P3, by its chromaticities — the profile Chromium tags shots with. */
function isDisplayP3(bytes) {
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    // cHRM holds the red primary at x/y * 100000. P3's is (0.680, 0.320), sRGB's (0.640, 0.330).
    if (type === 'cHRM') return Math.abs(bytes.readUInt32BE(at + 16) - 68000) < 500
    if (type === 'iCCP')
      return bytes
        .toString('latin1', at + 8, at + 8 + length)
        .toLowerCase()
        .includes('p3')
    if (type === 'IDAT' || type === 'IEND') return false
    at += 12 + length
  }
  return false
}

/** One row, with the PNG filter its writer chose undone into `row`. */
function unfilter(filter, encoded, previous, row, channels) {
  for (let i = 0; i < encoded.length; i++) {
    const left = i >= channels ? row[i - channels] : 0
    const up = previous[i]
    const upLeft = i >= channels ? previous[i - channels] : 0
    let value = encoded[i]
    if (filter === 1) value += left
    else if (filter === 2) value += up
    else if (filter === 3) value += (left + up) >> 1
    else if (filter === 4) value += paeth(left, up, upLeft)
    row[i] = value & 0xff
  }
}

function paeth(left, up, upLeft) {
  const guess = left + up - upLeft
  const toLeft = Math.abs(guess - left)
  const toUp = Math.abs(guess - up)
  const toUpLeft = Math.abs(guess - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

/**
 * The same colours, read as Display-P3 and written as sRGB: through the shared transfer curve into
 * linear light, across the two gamuts' matrices, and back. A P3 colour outside sRGB's gamut clips,
 * which is right for a comparison — sRGB is where both sides of a pair live.
 *
 * @param {Image} image
 * @returns {Image}
 */
export function displayP3ToSrgb(image) {
  const pixels = new Uint8Array(image.pixels.length)
  for (let i = 0; i < image.pixels.length; i += 4) {
    const red = toLinear(image.pixels[i])
    const green = toLinear(image.pixels[i + 1])
    const blue = toLinear(image.pixels[i + 2])
    pixels[i] = fromLinear(1.2249401762 * red - 0.2249401762 * green)
    pixels[i + 1] = fromLinear(-0.0420569547 * red + 1.0420569547 * green)
    pixels[i + 2] = fromLinear(-0.0196376011 * red - 0.0786361266 * green + 1.0982737277 * blue)
    pixels[i + 3] = image.pixels[i + 3]
  }
  return { width: image.width, height: image.height, pixels }
}

/** The sRGB transfer curve, which Display-P3 shares, in both directions. */
function toLinear(channel) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function fromLinear(value) {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

/**
 * The rectangle of an image, as an image of its own. This is how a frame's export becomes the
 * window the app draws, so the two sides of a pair are the same picture of the same thing.
 *
 * @param {Image} image
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {Image}
 */
export function cropImage(image, rect) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > image.width || rect.y + rect.height > image.height) {
    throw new Error(
      `crop ${rect.width}x${rect.height} at ${rect.x},${rect.y} falls outside ${image.width}x${image.height}`,
    )
  }
  const pixels = new Uint8Array(rect.width * rect.height * 4)
  for (let y = 0; y < rect.height; y++) {
    const from = ((y + rect.y) * image.width + rect.x) * 4
    pixels.set(image.pixels.subarray(from, from + rect.width * 4), y * rect.width * 4)
  }
  return { width: rect.width, height: rect.height, pixels }
}

/**
 * Each pixel replaced by the mean of the square of `radius` around it, per colour channel.
 *
 * This is the whole of {@link DIFF_BLUR}: a box mean, run once across and once down, which is the
 * same square and costs the same however wide it is. A pixel near an edge averages the
 * neighbourhood it has — the alternative is a border of its own that both images would share
 * anyway. Alpha is carried over rather than averaged: both sides of a pair are opaque.
 *
 * @param {Image} image
 * @param {number} radius
 * @returns {Image}
 */
export function blurImage(image, radius) {
  if (radius <= 0) return image
  const { width, height, pixels } = image
  const span = radius * 2 + 1
  const across = new Float32Array(width * height * 3)
  const blurred = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0
      for (let x = -radius; x <= radius; x++) sum += pixels[(y * width + edge(x, width)) * 4 + channel]
      for (let x = 0; x < width; x++) {
        across[(y * width + x) * 3 + channel] = sum / span
        sum += pixels[(y * width + edge(x + radius + 1, width)) * 4 + channel]
        sum -= pixels[(y * width + edge(x - radius, width)) * 4 + channel]
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) sum += across[(edge(y, height) * width + x) * 3 + channel]
      for (let y = 0; y < height; y++) {
        blurred[(y * width + x) * 4 + channel] = Math.round(sum / span)
        sum += across[(edge(y + radius + 1, height) * width + x) * 3 + channel]
        sum -= across[(edge(y - radius, height) * width + x) * 3 + channel]
      }
    }
  }
  for (let at = 3; at < blurred.length; at += 4) blurred[at] = pixels[at]
  return { width, height, pixels: blurred }
}

/** Where a neighbourhood runs off the image, the last row or column it did reach. */
function edge(at, size) {
  return at < 0 ? 0 : at >= size ? size - 1 : at
}

/**
 * How far apart two images are: the share of pixels, as a percentage, whose neighbourhood mean
 * differs from the other image's by more than `threshold` on some channel — and, when `tolerance`
 * is set, from every such mean within that many pixels of them too.
 *
 * The defaults are the measure `pnpm design:compare` prints, and the two forgivenesses in them are
 * the same forgiveness read twice. Pen's exporter and Chromium lay the same sentence out with
 * advance widths that disagree by up to a pixel, so a tab row that is right to the value scores
 * 12% of its band with no tolerance at all: `tolerance` forgives a glyph that is a pixel from
 * where the other image puts it. They also draw the glyph itself differently at the same place,
 * which no tolerance can forgive because nothing moved: `blur` forgives that, by reading the ink
 * in a neighbourhood rather than the pixel (T200). What survives both is a difference with an
 * area behind it — a missing element, a token one step off, a card in the wrong place, a control
 * the wrong size — and a shift of two pixels or more, which is the smallest one anybody can
 * measure between these two rasterisers.
 *
 * Alpha is left out. Both sides of a pair are opaque screenshots, and a difference nobody can see
 * is not drift.
 *
 * @param {Image} a
 * @param {Image} b
 * @param {{ threshold?: number, tolerance?: number, blur?: number }} options
 * @returns {number}
 */
export function diffScore(a, b, { threshold = DIFF_THRESHOLD, tolerance = DIFF_TOLERANCE, blur = DIFF_BLUR } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`cannot compare ${a.width}x${a.height} with ${b.width}x${b.height}`)
  }
  const softA = blurImage(a, blur)
  const softB = blurImage(b, blur)
  const { width, height } = a
  let differing = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (distance(softA, softB, x, y, x, y) <= threshold) continue
      if (tolerance > 0 && nearby(softA, softB, x, y, tolerance) <= threshold) continue
      differing++
    }
  }
  return (differing / (width * height)) * 100
}

/** How far one pixel of `a` is from one pixel of `b`, as the widest of its three channels. */
function distance(a, b, ax, ay, bx, by) {
  const from = (ay * a.width + ax) * 4
  const to = (by * b.width + bx) * 4
  return Math.max(
    Math.abs(a.pixels[from] - b.pixels[to]),
    Math.abs(a.pixels[from + 1] - b.pixels[to + 1]),
    Math.abs(a.pixels[from + 2] - b.pixels[to + 2]),
  )
}

/** The closest `b` comes to one pixel of `a` within `radius` of where it sits. */
function nearby(a, b, x, y, radius) {
  let closest = 255
  for (let dy = -radius; dy <= radius; dy++) {
    const ny = y + dy
    if (ny < 0 || ny >= b.height) continue
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx
      if (nx < 0 || nx >= b.width) continue
      closest = Math.min(closest, distance(a, b, x, y, nx, ny))
    }
  }
  return closest
}

/** A score as the sheet prints it: two decimals, so 0.4 and 0.44 are not the same number. */
export function formatScore(score) {
  return `${score.toFixed(2)}%`
}
