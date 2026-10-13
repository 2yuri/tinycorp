/**
 * The designed per-notification icon (design `hPz2P`): a rounded tile with the requester's
 * initials. Electron only honours `Notification.icon` on Windows and Linux, so the tile is drawn
 * here as raw pixels rather than by the OS, and macOS keeps the app icon (audit section 14).
 */

/** The tile, as `nativeImage.createFromBitmap` wants it: BGRA, top row first. */
export interface IconBitmap {
  width: number
  height: number
  data: Buffer
}

const SIZE = 64
const RADIUS = 14
/** `#334155` tile, `#CBD5E1` letters, `#F87171` for the budget's `!` (design `hPz2P`). */
const TILE = [0x33, 0x41, 0x55] as const
const INK = [0xcb, 0xd5, 0xe1] as const
const ALERT = [0xf8, 0x71, 0x71] as const

const GLYPH_W = 5
const GLYPH_H = 7
const SCALE = 5
const GAP = 3

/** A 5x7 bitmap font, enough for initials, digits and the budget's `!`. */
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
}

/** The letters of `text` the font can draw, at most two, as the design's tiles show them. */
export function iconLetters(text: string): string[] {
  return [...text.toUpperCase()].filter((c) => c in FONT).slice(0, 2)
}

/** The tile for a notification's `icon`, or null when nothing can be drawn on it. */
export function notificationIcon(text: string): IconBitmap | null {
  const letters = iconLetters(text)
  if (letters.length === 0) return null
  const ink = letters.join('') === '!' ? ALERT : INK
  const data = Buffer.alloc(SIZE * SIZE * 4)

  const put = (x: number, y: number, [r, g, b]: readonly [number, number, number]) => {
    const at = (y * SIZE + x) * 4
    data[at] = b
    data[at + 1] = g
    data[at + 2] = r
    data[at + 3] = 0xff
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inTile(x, y)) put(x, y, TILE)
    }
  }

  const textWidth = letters.length * GLYPH_W * SCALE + (letters.length - 1) * GAP * SCALE
  let left = Math.round((SIZE - textWidth) / 2)
  const top = Math.round((SIZE - GLYPH_H * SCALE) / 2)
  for (const letter of letters) {
    const glyph = FONT[letter]!
    for (let row = 0; row < GLYPH_H; row++) {
      for (let column = 0; column < GLYPH_W; column++) {
        if (glyph[row]![column] !== '1') continue
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            put(left + column * SCALE + dx, top + row * SCALE + dy, ink)
          }
        }
      }
    }
    left += (GLYPH_W + GAP) * SCALE
  }
  return { width: SIZE, height: SIZE, data }
}

/** Whether a pixel is inside the rounded square; corners stay transparent. */
function inTile(x: number, y: number): boolean {
  const near = (v: number) => (v < RADIUS ? RADIUS - v : v >= SIZE - RADIUS ? v - (SIZE - RADIUS - 1) : 0)
  const dx = near(x)
  const dy = near(y)
  return dx === 0 || dy === 0 || dx * dx + dy * dy <= RADIUS * RADIUS
}
