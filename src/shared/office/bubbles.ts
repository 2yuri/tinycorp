import type { OfficeSprite } from './projection'

/** What floats over a head, as in the office illustration. */
export type BubbleGlyph = '…' | '!' | '?' | 'Zzz'

/** Colours sampled from `design/office/illustration-2x.png`. */
export const BUBBLE_STYLE: Record<BubbleGlyph, { fill: number; edge: number; text: number }> = {
  '…': { fill: 0xe08a3c, edge: 0x9a5520, text: 0xfbeee0 },
  '!': { fill: 0xd2433e, edge: 0x8a2622, text: 0xfbeee0 },
  '?': { fill: 0x4375b2, edge: 0x27487a, text: 0xf2f4f8 },
  Zzz: { fill: 0x28345a, edge: 0x141c36, text: 0xc9d0e0 },
}

/**
 * The bubble over a sprite, or null: the projection's `!` (waiting on you) and `?` (blocked) first,
 * then `…` while Talking and `Zzz` while Idle.
 */
export function bubbleFor(sprite: Pick<OfficeSprite, 'state' | 'bubble'>): BubbleGlyph | null {
  if (sprite.bubble) return sprite.bubble
  if (sprite.state === 'talking') return '…'
  if (sprite.state === 'idle') return 'Zzz'
  return null
}
