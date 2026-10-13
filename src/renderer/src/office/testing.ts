/**
 * Test-only: reads a sheet out of the renderer's public folder the way the browser would, so a test
 * can run `sliceSheet` over the very PNG the app loads. Nothing in the app imports this; the browser
 * decodes its own PNGs, and Node has no canvas to do it with, so the decoding is done here by hand.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

export interface SheetPixels {
  rgba: Uint8ClampedArray
  width: number
  height: number
}

/** A sheet under `src/renderer/public/office/`, by file name. */
export function readOfficeSheet(name: string): SheetPixels {
  return decodePng(join(import.meta.dirname, '..', '..', 'public', 'office', name))
}

/** A PNG's pixels: 8 bits a channel, not interlaced, which is what the sheets are. */
export function decodePng(path: string): SheetPixels {
  const file = readFileSync(path)
  let at = 8
  let width = 0
  let height = 0
  let colour = 0
  let palette: Buffer | null = null
  let paletteAlpha: Buffer | null = null
  const parts: Buffer[] = []
  while (at < file.length) {
    const length = file.readUInt32BE(at)
    const type = file.toString('ascii', at + 4, at + 8)
    const data = file.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error(`${path}: ${data[8]} bits a channel`)
      if (data[12] !== 0) throw new Error(`${path}: interlaced`)
      colour = data[9]!
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') paletteAlpha = Buffer.from(data)
    else if (type === 'IDAT') parts.push(data)
    else if (type === 'IEND') break
    at += 12 + length
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour]
  if (!channels) throw new Error(`${path}: colour type ${colour}`)
  const lines = unfilter(inflateSync(Buffer.concat(parts)), width, height, channels)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const from = pixel * channels
    const to = pixel * 4
    if (colour === 3) {
      const index = lines[from]!
      rgba.set(
        [palette![index * 3]!, palette![index * 3 + 1]!, palette![index * 3 + 2]!, paletteAlpha?.[index] ?? 255],
        to,
      )
    } else if (colour === 0 || colour === 4) {
      const grey = lines[from]!
      rgba.set([grey, grey, grey, colour === 4 ? lines[from + 1]! : 255], to)
    } else {
      rgba.set([lines[from]!, lines[from + 1]!, lines[from + 2]!, colour === 6 ? lines[from + 3]! : 255], to)
    }
  }
  return { rgba, width, height }
}

/** Undoes the per-row filter every PNG row carries, which is what makes the stream compress. */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels
  const lines = Buffer.alloc(height * stride)
  let from = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[from++]!
    const row = y * stride
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? lines[row + i - channels]! : 0
      const up = y > 0 ? lines[row - stride + i]! : 0
      const corner = i >= channels && y > 0 ? lines[row - stride + i - channels]! : 0
      lines[row + i] = (raw[from + i]! + predictor(filter, left, up, corner)) & 0xff
    }
    from += stride
  }
  return lines
}

function predictor(filter: number, left: number, up: number, corner: number): number {
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  if (filter !== 4) return 0
  // Paeth: whichever of the three neighbours the gradient through them comes closest to.
  const guess = left + up - corner
  const toLeft = Math.abs(guess - left)
  const toUp = Math.abs(guess - up)
  const toCorner = Math.abs(guess - corner)
  return toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner
}
