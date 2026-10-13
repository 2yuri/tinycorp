import { Texture } from 'pixi.js'
import type { BubbleGlyph } from '../../../shared/office/bubbles'
import type { Point } from '../../../shared/office/layout'
import type { Box } from '../sprites'
import { loadSheet } from './sheet-textures'

/**
 * `office/office-marker-sheet.png` (from `design/office/office-marker-sheet.png`): the two things the
 * stage floats over a head, on one green-chroma sheet of two rows.
 * Row 1 is the emerald in three steps of its turn — face on and widest, three quarters, a narrow
 * sliver — so the boss's plumbob turns by swapping the drawing rather than by squashing one.
 * Row 2 is the speech bubble in its three colours, all empty: the glyph is drawn over it.
 */
const MarkerRow = {
  Emerald: 0,
  Bubble: 1,
} as const

/** The emerald's steps, widest first: the sheet draws its turn from face on to edge on. */
export const EMERALD_STEPS = 3

/**
 * Which of row 2's bubbles a glyph is drawn in. The sheet paints them amber, blue-grey and red, in
 * that order, and each glyph keeps the colour it has always had on the floor: `!` red, because the
 * boss's own call is the loud one; `…` amber while they talk; `?` blue-grey while they are blocked,
 * and `Zzz` the same quiet blue-grey, since the sheet has no fourth colour for sleep.
 */
export const BUBBLE_COLUMN: Record<BubbleGlyph, number> = {
  '!': 2,
  '…': 0,
  Zzz: 1,
  '?': 1,
}

/** A row of a bubble's drawing: the first and last pixel it has on that row. */
export interface RowSpan {
  left: number
  right: number
}

/** How much of the widest row a row has to reach to count as the bubble's box and not its tail. */
const BUBBLE_BODY_SHARE = 0.6

export interface BubbleFrame {
  texture: Texture
  /** The tip of the tail, in the frame's own pixels from its top-left: the point that lands on the head. */
  tip: Point
  /** The rounded box over that tail, in the same pixels: the glyph is centred in it, never on the tail. */
  body: Box
}

export interface EmeraldFrame {
  texture: Texture
  /** Mirror it: the same face of the diamond, seen from the other side of the turn. */
  flip: boolean
}

export interface MarkerFrames {
  /** The emerald at the turn `plumbobPose` gives, between -1 and 1. */
  emerald(turn: number): EmeraldFrame
  bubble(glyph: BubbleGlyph): BubbleFrame
}

/**
 * The step of the turn to draw, given the steps' own widths, widest first: the one whose width comes
 * closest to the share of the widest that the turn asks for. Face on (`turn` ±1) that is the widest
 * step; edge on (`turn` towards 0) it is the sliver, which is as narrow as the emerald ever gets.
 */
export function turnStep(turn: number, widths: readonly number[]): number {
  const wanted = Math.abs(turn) * widths[0]!
  let best = 0
  for (const [step, width] of widths.entries()) {
    if (Math.abs(width - wanted) < Math.abs(widths[best]! - wanted)) best = step
  }
  return best
}

/**
 * A drawn bubble split into the rounded box and the tail that hangs under it, from what the frame has
 * on each of its own rows, top to bottom. The box is the block of rows as wide as the widest; the tail
 * is the narrow rows below it, and its tip is the middle of the lowest row with anything on it.
 */
export function bubbleParts(rows: readonly (RowSpan | null)[]): { body: Box; tip: Point } {
  const widths = rows.map((row) => (row ? row.right - row.left + 1 : 0))
  const widest = Math.max(...widths)
  const isBody = (at: number) => widths[at]! >= widest * BUBBLE_BODY_SHARE
  const top = widths.findIndex((_, at) => isBody(at))
  const bottom = widths.findLastIndex((_, at) => isBody(at))
  const body = rows.slice(top, bottom + 1).filter((row) => row !== null)
  const left = Math.min(...body.map((row) => row.left))
  const right = Math.max(...body.map((row) => row.right))
  const last = widths.findLastIndex((width) => width > 0)
  const tail = rows[last]!
  return {
    body: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 },
    tip: { x: Math.round((tail.left + tail.right) / 2), y: last },
  }
}

/** What the frame has on each of its rows, top to bottom, read off the keyed sheet. */
export function frameRows(pixels: Uint8ClampedArray, sheetWidth: number, box: Box): (RowSpan | null)[] {
  const rows: (RowSpan | null)[] = []
  for (let y = box.y; y < box.y + box.h; y++) {
    let left = -1
    let right = -1
    for (let x = box.x; x < box.x + box.w; x++) {
      if (pixels[(y * sheetWidth + x) * 4 + 3]! === 0) continue
      if (left < 0) left = x - box.x
      right = x - box.x
    }
    rows.push(left < 0 ? null : { left, right })
  }
  return rows
}

export async function loadMarkers(base: string): Promise<MarkerFrames> {
  // The emerald is green: the key may take the screen away, and must leave the diamond's own greens.
  const sheet = await loadSheet(`${base}office-marker-sheet.png`, { greenSubject: true })
  const row = (at: number) => sheet.textures[at] ?? []
  const emeralds = row(MarkerRow.Emerald)
  const widths = (sheet.boxes[MarkerRow.Emerald] ?? []).map((box) => box?.w ?? 0)
  const bubbles = (sheet.boxes[MarkerRow.Bubble] ?? []).map((box, column) => ({
    texture: row(MarkerRow.Bubble)[column] ?? Texture.EMPTY,
    ...(box
      ? bubbleParts(frameRows(sheet.pixels, sheet.width, box))
      : { body: { x: 0, y: 0, w: 0, h: 0 }, tip: { x: 0, y: 0 } }),
  }))

  return {
    emerald(turn) {
      return { texture: emeralds[turnStep(turn, widths)] ?? Texture.EMPTY, flip: turn < 0 }
    },
    bubble(glyph) {
      return (
        bubbles[BUBBLE_COLUMN[glyph]] ?? {
          texture: Texture.EMPTY,
          body: { x: 0, y: 0, w: 0, h: 0 },
          tip: { x: 0, y: 0 },
        }
      )
    },
  }
}
