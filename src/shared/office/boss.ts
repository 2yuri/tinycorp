/**
 * The boss at their own desk (T86). `PAINTED_ROOM.boss` used to be a desk nobody drew; now the boss's
 * chosen character (Your profile, T79) sits on its seat whenever a Company is open, whatever the
 * Sessions are doing, and nobody else ever takes that seat.
 */
import { spriteIndex } from '../boss-profile'
import type { OfficeLayout, Spot } from './layout'

export { spotsClash } from './layout'

export interface BossAtDesk {
  /** The row of `characters.png` the boss picked in Your profile; the same sheet the Employees use. */
  sprite: number
  /** Where they sit, facing as the measured room's seat says. They never walk and never leave. */
  seat: Spot
}

/** The boss on the floor of `layout`, drawn with whichever character the profile last saved. */
export function bossAtDesk(layout: Pick<OfficeLayout, 'boss'>, sprite = 0): BossAtDesk {
  return { sprite: spriteIndex(sprite), seat: layout.boss.seat }
}
