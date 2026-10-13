import type { CompanyAttention } from '../../../shared/company'

/** Past this many the badge reads `9+`: the tile is 40px and the badge must not outgrow its corner. */
const MOST_SHOWN = 9

/**
 * What a rail tile draws besides its initials (T145): the badge when something waits on the boss,
 * the quieter working dot when a Session is busy, and nothing for an idle or closed Company. The
 * two marks are the office's own vocabulary — `waiting` and `live` — not a new idea of unread.
 */
export interface RailMarks {
  /** The Inbox's unread count as the badge prints it, or null when nothing waits. */
  badge: string | null
  working: boolean
  /** The tile's accessible name: the Company, then what the marks say. */
  label: string
}

export function railMarks(name: string, attention: CompanyAttention | undefined): RailMarks {
  const waiting = attention?.waiting ?? 0
  const working = attention?.working ?? false
  const said = [waiting > 0 && `${waiting} waiting on you`, working && 'working'].filter(Boolean)
  return {
    badge: waiting > 0 ? (waiting > MOST_SHOWN ? `${MOST_SHOWN}+` : String(waiting)) : null,
    working,
    label: said.length > 0 ? `${name}, ${said.join(', ')}` : name,
  }
}
