import type { OfficeSprite } from '../../../shared/office/projection'
import type { AwayPlace } from '../../../shared/office/reading'

/**
 * The label under a sprite on the office floor: who it is, and why it is where it is —
 * `Ada · In a meeting with Bob`, `Cy · Blocked` (T74).
 */
export function spriteTag(sprite: Pick<OfficeSprite, 'name' | 'reason' | 'onProvider'>): string {
  // Off its own Provider, the label says where it is working instead of why it is where it is:
  // `Vega · on <fallback>` (T173, frame `tdI8o` b). It stays at its desk — a switch is not a break.
  if (sprite.onProvider) return `${sprite.name} · on ${sprite.onProvider}`
  return `${sprite.name} · ${sprite.reason}`
}

/** What the floor draws for one Employee: one label at their own chair, one where they stand (T94). */
export interface FloorLabels {
  /**
   * Under their own chair: the whole tag while they are at it, their name alone while they are away.
   * Null for an Employee the room had no desk for, who has no chair to write it under (T101).
   */
  chair: string | null
  /** True while the chair label is the name alone, which is drawn dimmed: the desk is theirs, they are not on it. */
  dimmed: boolean
  /** Under the sprite itself, where they are standing, or null while that is their own chair. */
  away: string | null
}

/**
 * The places the floor packs people together, where the place carries the label and the people in it
 * carry none (T100): the counter, where the spots are a few pixels apart, and the meeting table,
 * whose four chairs sit within a sprite of each other. Each of those rooms already says how many are
 * in it and why, so a label on a sitter or a stander there only repeats the room, six times over.
 */
const CROWDED: ReadonlySet<AwayPlace> = new Set<AwayPlace>(['coffee', 'meeting'])

/**
 * The two labels, from where the sprite actually is (T94). At their own desk the chair says it all,
 * as it always has — an off Employee too, who is nowhere else, and whoever a full meeting table left
 * at their own chair. Away from it, the chair keeps the name alone so the floor still says whose desk
 * it is, and the status travels with the Employee: it is drawn under them, wherever they are
 * standing, and moves with them while they walk — unless they went somewhere crowded, where the room
 * itself speaks and they go quiet (T100).
 */
export function floorLabels(
  sprite: Pick<OfficeSprite, 'name' | 'reason' | 'away' | 'seat' | 'onProvider'>,
): FloorLabels {
  if (!sprite.away) return { chair: spriteTag(sprite), dimmed: false, away: null }
  // Whoever the room had no desk for has no chair to write a name under (T101).
  const chair = sprite.seat ? sprite.name : null
  if (CROWDED.has(sprite.away.place)) return { chair, dimmed: true, away: null }
  return { chair, dimmed: true, away: spriteTag(sprite) }
}
