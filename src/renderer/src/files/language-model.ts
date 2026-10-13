import type { Outlined } from '../../../shared/files/language'

/**
 * What the code panels around the file need (T115): what is marked on a line, which symbol of the
 * outline the boss is inside, and the trail of jumps that gives go-to-definition its way back. All
 * of it pure — the asking is the view's, the answering the main process's.
 *
 * Since T222 the file itself is drawn by Monaco, so nothing here reaches into the markup any more:
 * the hit test that found a symbol under the pointer, the anchor its card hung from and the spans
 * a painted line was cut into all went with the hand-written highlighter they were about.
 */

/** Where the boss was before they followed a symbol, so a click can take them back. */
export interface Jump {
  /** The place the file is in; null for one nowhere the Company owns (T121). */
  placeId: string | null
  path: string
  /** The line they were on, which is where Back lands them. */
  line: number
}

/** How many jumps back the viewer remembers; older ones are not worth the boss's memory either. */
export const TRAIL_LIMIT = 20

/** Following a definition: where they came from goes on the trail. */
export function pushJump(trail: readonly Jump[], from: Jump): Jump[] {
  return [...trail, from].slice(-TRAIL_LIMIT)
}

/** Back: the last jump comes off, and is where the viewer goes. */
export function popJump(trail: readonly Jump[]): { trail: Jump[]; back: Jump | null } {
  if (trail.length === 0) return { trail: [], back: null }
  return { trail: trail.slice(0, -1), back: trail[trail.length - 1]! }
}

/** `times · function`, the row of the outline. */
export function outlineLabel(symbol: Outlined): string {
  return `${symbol.name} · ${symbol.kind}`
}

/**
 * The symbol the outline marks while the boss is on a line: the last one that starts at or above
 * it, so a long function stays marked all the way down. Null when they are above them all.
 */
export function symbolOn(outline: readonly Outlined[], line: number | null): Outlined | null {
  if (line === null) return null
  let found: Outlined | null = null
  for (const symbol of outline) {
    if (symbol.line <= line) found = symbol
  }
  return found
}
