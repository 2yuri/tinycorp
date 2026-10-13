/**
 * The character sheets of `office/characters.png`: one row each, thirty-three looks — eighteen from
 * the three sheets that draw six characters apiece, and fifteen more drawn one character to a sheet
 * (`tools/character_rows.py`). The hire modal's LOOK tile, the engine's sprite hand-out and the
 * office all count them the same way, and `office/characters-coffee.png` holds the same rows with a
 * mug. It also carries how much floor one of them covers, which is what keeps two of them apart.
 */
import type { Point } from './painted-room'
export const CHARACTER_SHEETS = 33

/**
 * How much floor a character's drawing covers, in painting pixels: the sheet's widest body at the
 * office's character scale. Two spots closer than this in both directions read as one person sitting
 * on the other, which is what a spot the office hands out must never do.
 */
export const CHARACTER_FOOTPRINT = 40

/** True where a character standing on `a` would read as being on top of one on `b`. */
export function spotsClash(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < CHARACTER_FOOTPRINT && Math.abs(a.y - b.y) < CHARACTER_FOOTPRINT
}

/**
 * The sheet to hand out next, given the ones already in use: the least used, ties going to the
 * lowest index. The engine seats Employees this way and the setup wizard's draft mirrors it, so the
 * team the boss sees in Your team is the team that walks into the office.
 */
export function leastUsedSheet(used: number[]): number {
  const counts = Array.from({ length: CHARACTER_SHEETS }, () => 0)
  for (const sheet of used) counts[((sheet % CHARACTER_SHEETS) + CHARACTER_SHEETS) % CHARACTER_SHEETS]!++
  return counts.indexOf(Math.min(...counts))
}
