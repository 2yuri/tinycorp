/**
 * One reading of the office: what every Employee is doing, worked out in one pass over the whole
 * room so that no two of them describe the same moment differently (T92).
 *
 * The office used to decide each sprite on its own, and the floor could say two things at once:
 * `In a meeting with Nova` on one desk while Nova read `Talking to you` on hers. Here a meeting is
 * a set of Employees, not a claim each one makes: whoever the same live exchange sent to the
 * meeting room is in it, and each reason names the others in it. A visit has two sides — the guest
 * at the host's desk and the host in their chair, each naming the other — and happens only when
 * the host is there to answer. Whoever came to the boss stands at the boss chair and reads
 * `Talking to you`; because they are in one exchange only, nobody else can claim to be meeting them.
 *
 * The states themselves come from one table, `STATE_PRECEDENCE`, read top down: the first row whose
 * condition holds wins and the rest cannot happen, so a state that cannot be true with another is
 * never produced. The rows above `talking` hold on their own, which is what lets the room settle
 * them first and then work out the exchanges between whoever is left.
 *
 * The cadence of the trips themselves is decision 46's and lives in `movement.ts`; this module only
 * decides which of them the room agrees on.
 */
import type { SessionStatus } from '../session'
import type { Trip } from './movement'

/**
 * The things a sprite can show. Each one is backed by real engine state.
 * `starting` is a Session that was spawned and has not reached its prompt yet.
 * `parked` and `out_of_budget` Sessions are alive but get no prompts;
 * their Employees wait in the coffee area (decision 35).
 */
export type SpriteState =
  | 'starting'
  | 'idle'
  | 'working'
  | 'reading'
  | 'talking'
  | 'waiting'
  | 'blocked'
  | 'parked'
  | 'out_of_budget'
  | 'off'

/** Where a state stands an Employee when it is not their own desk. */
export type AwayPlace = 'desk' | 'boss' | 'meeting' | 'coffee'

/** `!` waiting on the boss, `?` blocked. */
export type Bubble = '!' | '?'

/** What each state is called on screen and in the office legend. */
export const STATE_LABEL: Record<SpriteState, string> = {
  off: 'Off',
  starting: 'Starting…',
  idle: 'Idle',
  working: 'Working',
  reading: 'Reading',
  talking: 'Talking',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
  parked: 'Parked',
  out_of_budget: 'Out of budget',
}

/** What an Employee who came to talk to the boss reads; the boss is one of the people in the room. */
export const BOSS_TALK_REASON = 'Talking to you'

/**
 * A live exchange, as the whole room agreed on it:
 * - `meeting`: the set that one exchange sent to the glass room, minus whoever it is for;
 * - `visiting`: a DM or an `@Name`, the guest standing at the host's desk;
 * - `hosting`: the other side of that visit, the host in their own chair;
 * - `boss`: a DM or an `@boss`, at the boss chair.
 */
export interface Exchange {
  kind: 'meeting' | 'visiting' | 'hosting' | 'boss'
  /** The other Employees the exchange is about; empty with the boss, who has no sprite of their own. */
  withIds: string[]
  /** When the Employee walks back. */
  endsAt: number
}

/** One Employee as the precedence table reads them. */
export interface EmployeeFacts {
  session: SessionStatus
  /** The tool their Session runs, or ran last this turn. */
  tool: string | null
  /** They have an approval the boss has not decided. */
  approvalPending: boolean
  /** Their Session stopped in its terminal to ask the boss before it acts (T165). */
  askingInTerminal: boolean
  /** They hold a ticket that is blocked. */
  ticketBlocked: boolean
  /** The exchange the room settled on for them, or null. Only the rows under `waiting` can see one. */
  exchange: Exchange | null
}

export interface StateRow {
  state: SpriteState
  /** What has to be true. Rows are read top down and the first one that holds wins. */
  when: (facts: EmployeeFacts) => boolean
  /** Where the state stands them, or null at their own desk. */
  place: (facts: EmployeeFacts) => AwayPlace | null
  bubble?: Bubble
  /** Why this row sits above the ones under it. */
  over: string
}

/** Where each kind of exchange stands an Employee. A host does not move: the guest comes to them. */
const EXCHANGE_PLACE: Record<Exchange['kind'], AwayPlace | null> = {
  meeting: 'meeting',
  visiting: 'desk',
  hosting: null,
  boss: 'boss',
}

const nowhere = () => null

/**
 * The one precedence table: a single state per Employee, the first row that holds. The order is the
 * order of what stops the work — a Session that is not running, then one that is running but gets no
 * prompts, then the two things only the boss can clear, then what the Employee is doing right now.
 *
 * `off` is first, not last: no Session means nothing else about the Employee can be shown.
 * `waiting` sits above `blocked` because the "!" is the boss's own call to make, and both sit above
 * `talking` so nobody is walked into a meeting they cannot be at. `blocked` only holds while the
 * Session is not busy: an Employee holds many tickets, and one of them blocked says nothing about one
 * working on another (T273). `meeting` beats `visiting` inside `talking`, in `readRoom`. Every row
 * under `talking` reads the desk, in order of how loud it is.
 */
export const STATE_PRECEDENCE: StateRow[] = [
  {
    state: 'off',
    when: (f) => f.session === 'off',
    place: nowhere,
    over: 'No Session is running: the chair is empty, whatever else the engine remembers.',
  },
  {
    state: 'out_of_budget',
    when: (f) => f.session === 'out_of_budget',
    place: () => 'coffee',
    over: 'The Session is alive but gets no prompts until the usage limit resets (decision 35).',
  },
  {
    state: 'parked',
    when: (f) => f.session === 'parked',
    place: () => 'coffee',
    over: 'The Session is alive but parked: it gets no prompts either.',
  },
  {
    state: 'waiting',
    when: (f) => f.approvalPending || f.askingInTerminal,
    place: () => 'boss',
    bubble: '!',
    over:
      'Something of theirs needs the boss — an Approval, or their Session stopped in its terminal ' +
      'to ask before it acts (T165): they stand at the boss desk until it is answered.',
  },
  {
    state: 'blocked',
    when: (f) => f.ticketBlocked && f.session !== 'busy',
    place: () => 'coffee',
    bubble: '?',
    over:
      'A ticket they hold is blocked and their Session has stopped, so the ticket is why. A busy ' +
      'Session is working on something real, and the rows under this one say what (T273).',
  },
  {
    state: 'talking',
    when: (f) => f.exchange !== null,
    place: (f) => (f.exchange ? EXCHANGE_PLACE[f.exchange.kind] : null),
    over: 'A live exchange the whole room agreed on: a meeting, a visit, or a word with the boss.',
  },
  {
    state: 'reading',
    when: (f) => f.session === 'busy' && f.tool !== null && isReadingTool(f.tool),
    place: nowhere,
    over: 'Busy on a tool that only looks.',
  },
  {
    state: 'working',
    when: (f) => f.session === 'busy',
    place: nowhere,
    over: 'Busy on anything else, including before the turn’s first tool.',
  },
  {
    state: 'starting',
    when: (f) => f.session === 'starting',
    place: nowhere,
    over: 'The Session was spawned and has not reached its prompt yet.',
  },
  { state: 'idle', when: () => true, place: nowhere, over: 'At their desk with nothing to do.' },
]

/** The row `talking` sits at: everything above it holds on its own, everything below reads the desk. */
const TALKING_ROW = STATE_PRECEDENCE.findIndex((row) => row.state === 'talking')

/** Where one Employee stands and what they say about it. */
export interface Standing {
  state: SpriteState
  /** Where they stand, or null at their own desk. */
  place: AwayPlace | null
  /** The exchange the room settled on for them, naming whoever it is with; null when there is none. */
  exchange: Exchange | null
  /** Why they are where they are, in one phrase: `In a meeting with Nova and Vega`, `Blocked`. */
  reason: string
  bubble?: Bubble
  /** What they would show with no exchange, for a floor that has no room for the trip. */
  seated?: Standing
}

export interface RoomFacts {
  /** Everyone in the room, in the order the floor reads them. */
  employees: { id: string; name: string }[]
  sessions: Record<string, SessionStatus>
  /** The tool each Session runs, by Employee id. */
  tools: Record<string, string | null>
  /** Employees with an approval the boss has not decided. */
  waiting: ReadonlySet<string>
  /** Employees whose Session stopped in its terminal to ask the boss (T165). */
  asking?: ReadonlySet<string>
  /** Employees holding a blocked ticket. */
  blocked: ReadonlySet<string>
  /** The trip each Employee's own posts offered them (decision 46). */
  trips: ReadonlyMap<string, Trip>
  /** Employees the floor has no desk for: they wait at the coffee counter and join no exchange. */
  noDesk?: ReadonlySet<string>
}

/**
 * The whole room in one pass, by Employee id. Every Employee gets exactly one state, and the
 * exchanges are worked out between them, never claimed one at a time.
 */
export function readOffice(room: RoomFacts): Map<string, Standing> {
  const nameOf = new Map(room.employees.map((e) => [e.id, e.name]))
  const facts = new Map(
    room.employees.map((e): [string, EmployeeFacts] => [
      e.id,
      {
        session: room.sessions[e.id] ?? 'off',
        tool: room.tools[e.id] ?? null,
        approvalPending: room.waiting.has(e.id),
        askingInTerminal: room.asking?.has(e.id) ?? false,
        ticketBlocked: room.blocked.has(e.id),
        exchange: null,
      },
    ]),
  )
  // Whoever nothing above `talking` already settled, and whom the floor has a desk for, is free to
  // be in an exchange. Everyone else is somewhere the room can see, so nobody may name them.
  const free = room.employees.map((e) => e.id).filter((id) => !settledAbove(facts.get(id)!) && !room.noDesk?.has(id))
  const exchanges = readRoom(free, room.trips)

  const standings = new Map<string, Standing>()
  for (const { id } of room.employees) {
    const mine = { ...facts.get(id)!, exchange: exchanges.get(id) ?? null }
    const seated = mine.exchange ? standingFor({ ...mine, exchange: null }, nameOf) : undefined
    standings.set(id, { ...standingFor(mine, nameOf), ...(seated ? { seated } : {}) })
  }
  return standings
}

/** The row above `talking` that already holds for these facts, if any. None of them needs the room. */
function settledAbove(facts: EmployeeFacts): StateRow | undefined {
  return STATE_PRECEDENCE.slice(0, TALKING_ROW).find((row) => row.when(facts))
}

function standingFor(facts: EmployeeFacts, nameOf: ReadonlyMap<string, string>): Standing {
  const row = STATE_PRECEDENCE.find((one) => one.when(facts))!
  const exchange = row.state === 'talking' ? facts.exchange : null
  const names = (exchange?.withIds ?? []).map((id) => nameOf.get(id)).filter((name) => name !== undefined)
  return {
    state: row.state,
    place: row.place(facts),
    exchange,
    reason: exchange ? exchangeReason(exchange, names) : STATE_LABEL[row.state],
    ...(row.bubble ? { bubble: row.bubble } : {}),
  }
}

/**
 * The exchanges the room agrees on, by Employee id, over the Employees free to be in one.
 *
 * A meeting is the set of them the same exchange sent to the glass room, so the ones it dropped —
 * someone the boss needs, someone blocked, someone whose minute-long cadence held them back, someone
 * who has not spoken yet — are in nobody's reason. A meeting of one is not a meeting. A visit needs
 * a host who is free to answer: when two would call on each other, the older trip is the one the
 * room shows.
 */
function readRoom(free: string[], trips: ReadonlyMap<string, Trip>): Map<string, Exchange> {
  const order = new Map(free.map((id, i) => [id, i]))
  const tripOf = (id: string) => (order.has(id) ? trips.get(id) : undefined)
  const found = new Map<string, Exchange>()

  const meetings = new Map<string, string[]>()
  for (const id of free) {
    const trip = tripOf(id)
    if (trip?.place === 'meeting') meetings.set(trip.exchangeId, [...(meetings.get(trip.exchangeId) ?? []), id])
  }
  for (const members of meetings.values()) {
    if (members.length < 2) continue
    for (const id of members) {
      found.set(id, { kind: 'meeting', withIds: members.filter((other) => other !== id), endsAt: tripOf(id)!.endsAt })
    }
  }

  for (const id of free) {
    const trip = tripOf(id)
    if (trip?.place === 'boss' && !found.has(id)) found.set(id, { kind: 'boss', withIds: [], endsAt: trip.endsAt })
  }

  const callers = free
    .filter((id) => tripOf(id)?.place === 'desk')
    .sort((a, b) => tripOf(a)!.startedAt - tripOf(b)!.startedAt || order.get(a)! - order.get(b)!)
  for (const guest of callers) {
    if (found.has(guest)) continue
    const trip = tripOf(guest)!
    const host = trip.withIds[0]
    if (host === undefined || host === guest || !order.has(host) || found.has(host)) continue
    found.set(guest, { kind: 'visiting', withIds: [host], endsAt: trip.endsAt })
    found.set(host, { kind: 'hosting', withIds: [guest], endsAt: trip.endsAt })
  }
  return found
}

function exchangeReason(exchange: Exchange, names: string[]): string {
  if (exchange.kind === 'boss') return BOSS_TALK_REASON
  if (exchange.kind === 'meeting') return meetingReason(names)
  return `Talking to ${names[0] ?? 'a colleague'}`
}

/** `In a meeting with Nova`, `…with Nova and Vega`, `…with Nova and 2 others`. */
export function meetingReason(names: string[]): string {
  const [first, second, ...rest] = names
  if (!first) return 'In a meeting'
  if (!second) return `In a meeting with ${first}`
  if (rest.length === 0) return `In a meeting with ${first} and ${second}`
  return `In a meeting with ${first} and ${rest.length + 1} others`
}

/** Tools that only look: a busy Session running one of them is Reading. */
const READING_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'TodoRead',
  'BashOutput',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  // Company MCP tools that change nothing.
  'board_list',
  'chat_read',
  'team_load',
])

/** True for a read-only tool; MCP tools are known by their own name, e.g. `mcp__company__board_list`. */
export function isReadingTool(tool: string): boolean {
  return READING_TOOLS.has(tool.replace(/^mcp__.+?__/, ''))
}
