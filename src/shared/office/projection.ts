import type { ApprovalStatus } from '../approvals'
import type { Column } from '../domain/board'
import type { Employee } from '../domain/staff'
import type { SessionStatus } from '../session'
import { type BossAtDesk, bossAtDesk } from './boss'
import { counterLabel } from './counter'
import { type OfficeLayout, officeLayout, type Seat, type Spot, visitorSpot } from './layout'
import { type ChatPost, officeTrips } from './movement'
import { type AwayPlace, type Bubble, readOffice, type SpriteState, type Standing } from './reading'
import { DEFAULT_ROOM, type RoomSlug, roomGeometry } from './rooms'

export { type Bubble, isReadingTool, type SpriteState, STATE_LABEL } from './reading'

export interface OfficeSprite {
  employeeId: string
  name: string
  title: string
  /** Index of the character sheet. */
  sprite: number
  state: SpriteState
  /**
   * Their own chair. Absent for an Employee the room had no desk for: the painting seats what it
   * seats, and past that they wait at the counter with no chair of their own (T101).
   */
  seat?: Seat
  /** Why the sprite is where it is, in one phrase: `In a meeting with Nova` (T74). */
  reason: string
  /**
   * The Employees the reason names, as the whole room agreed on them (T92): every id here names this
   * sprite back, so the floor never says two things about one moment.
   */
  withIds: string[]
  /** `!` waiting on the boss, `?` blocked. */
  bubble?: Bubble
  /** Where the sprite is when it is not at its desk. */
  away?: AwaySpot
  /** The Provider it is working on while its own is out (T173); absent while it is on its own. */
  onProvider?: string
}

/** A spot away from the desk: next to someone's desk (`desk`, `boss`), in the meeting room or the coffee area. */
export interface AwaySpot extends Spot {
  place: AwayPlace
  /** True where the spot is a chair, not standing room: the meeting room's table. */
  seated?: boolean
}

export interface OfficeScene {
  /** The room the Company chose; the painting the stage draws comes from the registry. */
  room: RoomSlug
  layout: OfficeLayout
  sprites: OfficeSprite[]
  /** The boss at their own desk, drawn whatever the Sessions are doing (T86). */
  boss: BossAtDesk
  /** Approvals waiting on the boss desk, from anyone. */
  pendingApprovals?: number
  /** When the scene changes by time alone (a trip is over), or null. Project again then. */
  nextChangeAt?: number | null
  /**
   * How many Employees the meeting on now is for: the ones the table seated and the ones it could
   * not, which is what the glass room's own label counts (T94). 0 when no meeting is on.
   */
  meetingCount?: number
  /**
   * What the coffee corner says over the group standing at it — `At the counter · 6 parked` — or
   * null while nobody is there (T100). It belongs with the room's own labels, beside the meeting
   * count: the projection knows who is at the counter, so it says how many and why in one string
   * and nobody standing there carries a label of their own.
   */
  counterLabel?: string | null
}

/** What an Employee's Session has been doing, as the engine saw it. */
export interface EmployeeActivity {
  /** The tool the Session runs, or ran last in this turn. Null before the first tool of a turn. */
  tool: string | null
  /** The Employee's recent chat posts, oldest first; what sends them across the room (T74). */
  posts: ChatPost[]
}

export interface OfficeInput {
  employees: Employee[]
  /** The Company's room (T83); the default one until the boss picks another. */
  room?: RoomSlug
  /** The character the boss picked in Your profile (T79); the first sheet until they pick one. */
  bossSprite?: number
  /** Session status by Employee id. Employees missing here are Off. */
  sessions?: Record<string, SessionStatus>
  /** Activity by Employee id. */
  activity?: Record<string, EmployeeActivity>
  approvals?: { requesterId: string; status: ApprovalStatus }[]
  /**
   * Employees whose Session stopped in its terminal to ask the boss before it acts (T165). They
   * are waiting on the boss exactly as an undecided Approval's requester is, and the floor draws
   * them the same way: at the boss desk, hand up, with the `!`.
   */
  asking?: string[]
  /**
   * The Provider each Employee is working on while its own is out (T173), by Employee id, in the
   * name the boss reads. The floor labels those sprites `Vega · on Codex` (frame `tdI8o`, b) —
   * switching Provider is not a break, so they stay at their own desks.
   */
  routed?: Record<string, string>
  tickets?: { assigneeId: string | null; blocked: boolean; column: Column }[]
  /** Epoch ms; defaults to the clock. */
  now?: number
}

/** Everything the projection needs from the engine besides the Employees, as the engine sends it over IPC. */
export type OfficeFacts = Required<
  Pick<OfficeInput, 'room' | 'sessions' | 'activity' | 'approvals' | 'tickets' | 'asking' | 'routed'>
>

/** Why an Employee stands at the coffee counter with no desk of their own. */
export const NO_DESK_REASON = 'Waiting for a desk'

/**
 * Why an Employee a full meeting table left at their own desk is there: in the meeting, from their
 * chair. The glass room already counts them and the drawer names who else is in it, so the floor
 * says it short — `Bo · in the meeting`, as `design/screens/p3YoI.png` 2A draws it (T156).
 */
export const MEETING_AT_DESK_REASON = 'in the meeting'

/**
 * Engine state in, office out. The states come from one precedence table and the exchanges are
 * worked out for the whole room at once, in `reading.ts`, so no two sprites contradict each other.
 * This function only puts that reading on the floor: who sits where, and which spot each trip goes
 * to — a chair at the meeting table, the one place at the boss desk, the visitor's spot beside the
 * host's own chair, or a place at the coffee counter.
 *
 * Whoever is not away sits at their own desk; whoever finds it taken takes a free one, and only with
 * none free do they wait at the coffee counter — and the room is read again so nobody in an exchange
 * names someone the floor could not seat.
 */
export function projectOffice({
  employees,
  room = DEFAULT_ROOM,
  bossSprite = 0,
  sessions = {},
  activity = {},
  approvals = [],
  asking = [],
  routed = {},
  tickets = [],
  now = Date.now(),
}: OfficeInput): OfficeScene {
  const layout = officeLayout(roomGeometry(room))
  const pending = approvals.filter((a) => a.status === 'pending')
  const posts = Object.fromEntries(Object.entries(activity).map(([id, one]) => [id, one.posts]))
  const facts = {
    employees,
    sessions,
    tools: Object.fromEntries(Object.entries(activity).map(([id, one]) => [id, one.tool])),
    waiting: new Set(pending.map((a) => a.requesterId)),
    asking: new Set(asking),
    blocked: new Set(
      tickets.filter((t) => t.blocked && t.column !== 'done' && t.assigneeId).map((t) => t.assigneeId as string),
    ),
    trips: officeTrips(posts, new Set(employees.map((e) => e.id)), now),
  }

  /**
   * Employees the room has no chair numbered for: the Company outgrew the painting, and since every
   * lower-numbered desk belongs to someone else there is nowhere to move them to (T101). Whoever is
   * off is not in the room at all, so they wait for nothing and the counter does not count them.
   */
  const unnumbered = new Set(
    employees.filter((e) => !layout.seats[e.desk] && (sessions[e.id] ?? 'off') !== 'off').map((e) => e.id),
  )

  /** Desks that belong to an Employee; a desk nobody was given is free for whoever finds theirs taken. */
  const owned = new Set(employees.flatMap((e) => (layout.seats[e.desk] ? [layout.seats[e.desk]!.uid] : [])))

  /**
   * Who sits where. A host is seated first: their guest stands beside that very chair, so the host
   * must not be the one a desk collision moves. Whoever finds no free desk is noted as having none.
   */
  const seating = (reading: Map<string, Standing>) => {
    const claimed = new Set<string>()
    const seats = new Map<string, Seat>()
    const noDesk = new Set<string>(unnumbered)
    const sitting = employees.filter((e) => {
      const standing = reading.get(e.id)!
      return standing.place === null && standing.state !== 'off' && !unnumbered.has(e.id)
    })
    const hostsFirst = [...sitting].sort((a, b) => rankOfHost(reading.get(a.id)!) - rankOfHost(reading.get(b.id)!))
    for (const employee of hostsFirst) {
      const own = layout.seats[employee.desk]!
      const free = claimed.has(own.uid) ? layout.seats.find((s) => !claimed.has(s.uid) && !owned.has(s.uid)) : own
      if (!free) {
        noDesk.add(employee.id)
        continue
      }
      claimed.add(free.uid)
      seats.set(employee.id, free)
    }
    return { seats, noDesk }
  }

  let reading = readOffice(facts)
  let seated = seating(reading)
  if (seated.noDesk.size > 0) {
    // The floor ran out of desks: read the room again with those Employees out of every exchange.
    reading = readOffice({ ...facts, noDesk: seated.noDesk })
    seated = seating(reading)
  }
  /** The chair an Employee sits at; none for one who is off with no numbered desk in this room. */
  const seatOf = (employeeId: string, desk: number): Seat | undefined =>
    seated.seats.get(employeeId) ?? layout.seats[desk]
  /** Both sides of a visit the floor could not seat: with no host's chair to stand at there is no visit. */
  const dropped = new Set(
    employees.flatMap(({ id }) => {
      const exchange = reading.get(id)!.exchange
      const host = exchange?.kind === 'visiting' ? exchange.withIds[0] : undefined
      return host !== undefined && seated.noDesk.has(host) ? [id, host] : []
    }),
  )

  let nextChangeAt: number | null = null
  /** Everyone one exchange sent to the glass room, whether or not the table had a chair left. */
  let meetingCount = 0
  let meeting = 0
  let coffee = 0
  /** The boss desk has room for one visitor; whoever gets there first keeps it. */
  let bossSpotFree = true
  const coffeeSpot = (): AwaySpot => ({ ...layout.coffee[coffee++ % layout.coffee.length]!, place: 'coffee' })

  /** The one visiting spot at the boss desk, or null once someone is standing there. */
  const bossSpot = (): AwaySpot | null => {
    if (!bossSpotFree) return null
    bossSpotFree = false
    return { ...visitorSpot(layout.boss), place: 'boss' }
  }

  /** The spot a standing goes to, or null when the floor has no room for it and the Employee stays put. */
  const spotFor = (standing: Standing): AwaySpot | null => {
    if (standing.place === 'coffee') return coffeeSpot()
    if (standing.place === 'boss') return bossSpot()
    if (standing.place === 'desk') {
      const host = standing.exchange?.withIds[0]
      const chair = host === undefined ? undefined : seated.seats.get(host)
      return chair ? { ...visitorSpot(chair), place: 'desk' } : null
    }
    // One chair each: a meeting bigger than the table leaves the rest at their desks.
    const chair = layout.meeting[meeting++]
    return chair ? { ...chair, place: 'meeting', seated: true } : null
  }

  const sprites = employees.map((employee): OfficeSprite => {
    const read = reading.get(employee.id)!
    const standing = dropped.has(employee.id) ? (read.seated ?? read) : read
    const who = {
      employeeId: employee.id,
      name: employee.name,
      title: employee.title,
      sprite: employee.sprite,
    }
    const onProvider = routed[employee.id]
    if (seated.noDesk.has(employee.id)) {
      return {
        ...who,
        state: standing.state,
        reason: NO_DESK_REASON,
        withIds: [],
        away: coffeeSpot(),
        ...(onProvider ? { onProvider } : {}),
      }
    }
    const away = standing.place === null ? null : spotFor(standing)
    if (standing.exchange) nextChangeAt = Math.min(nextChangeAt ?? Infinity, standing.exchange.endsAt)
    // The room counts itself off the exchange, not off the chairs: four at the table and two left
    // at their desks are still a meeting of six (T94).
    if (standing.exchange?.kind === 'meeting') meetingCount++
    const seat = seatOf(employee.id, employee.desk)
    return {
      ...who,
      ...(seat ? { seat } : {}),
      state: standing.state,
      reason: standing.exchange?.kind === 'meeting' && !away ? MEETING_AT_DESK_REASON : standing.reason,
      withIds: standing.exchange?.withIds ?? [],
      ...(standing.bubble ? { bubble: standing.bubble } : {}),
      ...(away ? { away } : {}),
      ...(onProvider ? { onProvider } : {}),
    }
  })

  return {
    room,
    layout,
    sprites,
    boss: bossAtDesk(layout, bossSprite),
    nextChangeAt,
    meetingCount,
    counterLabel: counterLabel(
      sprites
        .filter((sprite) => sprite.away?.place === 'coffee')
        .map((sprite) => ({ state: sprite.state, reason: sprite.reason })),
    ),
    pendingApprovals: pending.length,
  }
}

/** Hosts sort first when the desks are handed out; everyone else keeps the floor's own order. */
function rankOfHost(standing: Standing): number {
  return standing.exchange?.kind === 'hosting' ? 0 : 1
}
