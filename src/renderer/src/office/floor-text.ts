import { Text, type TextStyleOptions } from 'pixi.js'

/** Text is rasterised at this resolution so it stays sharp when the stage is zoomed in. */
export const TEXT_RES = 4

/**
 * How every word on the floor is set, as both floor-label frames set every Tag (T156): bold, with a
 * navy outline all round. The frames once gave the Tags a soft drop shadow, one pixel down; that was
 * drawn on a dark card, and on a light room — Scandi Daylight's pale boards — white text with only
 * that shadow under it all but disappears. The outline reads on every floor, so the frames were
 * changed to it rather than the floor to them.
 */
export const FLOOR_TEXT_STYLE = {
  fontFamily: 'Inter Variable, system-ui, sans-serif',
  fontSize: 10,
  fontWeight: '700',
  fill: 0xf2f2f5,
  stroke: { color: 0x0b1220, width: 3, join: 'round' },
} as const satisfies TextStyleOptions

/** Crisp small text in painting pixels, centred on `x`: every word the office writes on its floor. */
export function floorText(text: string, x: number, y: number): Text {
  const tag = new Text({ text, style: FLOOR_TEXT_STYLE, resolution: TEXT_RES })
  tag.anchor.set(0.5, 0)
  tag.position.set(x, y)
  return tag
}
