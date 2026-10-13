import { useEffect, useState } from 'react'
import type { Employee } from '../../../../shared/domain/staff'
import { officeLayout } from '../../../../shared/office/layout'
import type { ChatPost } from '../../../../shared/office/movement'
import { projectOffice } from '../../../../shared/office/projection'
import { DEFAULT_ROOM, isRoomSlug, type RoomSlug, roomGeometry } from '../../../../shared/office/rooms'
import type { SessionStatus } from '../../../../shared/session'
import { Office } from '../Office'

/**
 * The office stage at 1040×660 with a team that walks: one Employee at every painted desk, and two
 * more who answer each other in `#tech` `?delay` ms in, so the exchange becomes a meeting and both
 * set off for the glass room — a screenshot catches the door open with someone in the gap, then the
 * pair seated at the table. One more is Blocked, so the coffee counter has someone waiting at it.
 * `?room` picks the painting, so a measured room (T84, T85) can be captured against its art.
 * `?boss` picks the character the boss sits at their own desk with, and `?approval=1` sends one
 * Employee to stand at that desk with their `!`, which is what T86's capture shows.
 * `?everyone=<state>` puts the whole team in one state instead — `parked`, `out_of_budget`, `idle`,
 * `starting` or `blocked` — which is how a room is checked against the states that move everybody at
 * once: a usage limit, Pause all, or a stall (T93 follow-up). It drops the three who are there for
 * the meeting and the queue, so the team is exactly the Company the painting seats: what the room
 * has to hold at its own capacity, and no more.
 * `?meeting=<n>` is the same team with the first `n` of them in one exchange, which is how a meeting
 * bigger than the table is checked (T94): four walk in and the rest stay at their own desks, and the
 * glass room states the whole number.
 * `?over=<n>` hires `n` past what the room seats, which is how the full room is checked (T101, T111):
 * every chair the painting draws is taken, the Employees past them wait at the counter with no chair
 * of their own, and nothing is drawn below the painting.
 */
const employee = (name: string, desk: number, sprite: number): Employee => ({
  id: `id-${name}`,
  name,
  desk,
  roleId: 'backend',
  title: 'Backend',
  persona: '',
  capabilities: ['code'],
  repoFilter: [],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  sprite,
  createdAt: '2026-09-17T00:00:00.000Z',
})

/**
 * Whoever the boss owes a decision: they go and stand at the boss desk, beside the seated boss.
 * Lower case, both of them: an upper-case string constant in a file Tailwind reads is a class list
 * by this repo's convention, and a first name is not one.
 */
const visitor = 'Di'
const TALKERS = ['Ada', 'Eve']
const blocked = 'Cy'
const SITTER_NAMES = ['Bo', 'Flo', 'Gus', 'Hal', 'Ida', 'Jo', 'Kit', 'Lou', 'Max', 'Nel', 'Ola', 'Pip']

/**
 * The team a room's painting can show all of at once: one Employee per desk the room has, plus the
 * three the scene is about — the pair that meets and the one queueing for coffee. Those three are
 * always away from a desk, so they share a sitter's index rather than taking a desk of their own.
 * `?approval=1` adds one more, who stands at the boss desk with their `!`.
 */
function staffFor(room: RoomSlug, withVisitor: boolean, onlySitters = false, over = 0, size?: number): Employee[] {
  const seats = size ?? officeLayout(roomGeometry(room)).seats.length
  // `?look=<n>` starts the sitters at that row of `characters.png` instead of the sixth, which is
  // how a look added to the sheet is checked in every pose at once — seated with its back to us,
  // seated from the front at a far chair, walking, reading — rather than one pose at a time.
  const first = Number(new URLSearchParams(location.search).get('look') ?? 6)
  // Anyone past the room's own desks has none: they wait at the counter, and the header says so.
  const sitting = Array.from({ length: seats + over }, (_, i) =>
    employee(SITTER_NAMES[i % SITTER_NAMES.length]!, i, first + i),
  )
  if (onlySitters) return sitting
  // Spread over the desks rather than piled on one, so the floor names they leave behind do not
  // land on top of each other.
  const borrowed = (i: number) => Math.floor((i * seats) / 4) % Math.max(seats, 1)
  const away = [
    employee(TALKERS[0]!, borrowed(0), 1),
    employee(TALKERS[1]!, borrowed(1), 2),
    employee(blocked, borrowed(2), 3),
  ]
  return [...sitting, ...away, ...(withVisitor ? [employee(visitor, borrowed(3), 4)] : [])]
}

export function OfficeCapture() {
  const [now] = useState(() => Date.now())
  const query = new URLSearchParams(location.search)
  const delay = Number(query.get('delay') ?? 3000)
  const wanted = query.get('room')
  const room = isRoomSlug(wanted) ? wanted : DEFAULT_ROOM
  const everyone = query.get('everyone')
  // A meeting of `n` is drawn from the sitters alone, so everyone in it owns a desk to be missed from.
  const meeting = Math.max(0, Number(query.get('meeting') ?? 0))
  // Employees past what the room seats: they wait at the counter, which is the room full (T101).
  const over = Math.max(0, Number(query.get('over') ?? 0))
  // `?team=N` shoots a Company of exactly N, for the room a new Company opens with nobody in it.
  const size = query.get('team') === null ? undefined : Math.max(0, Number(query.get('team')))
  const team = staffFor(
    room,
    Boolean(query.get('approval')),
    Boolean(everyone) || meeting > 0 || size !== undefined,
    over,
    size,
  )
  /** A named member of the fixture, or nobody: `?team=0` shoots the room a new Company opens with. */
  const byName = (name: string) => team.find((one) => one.name === name)
  // `?delay=0` starts the scene with them already in the room: the sprites are placed there rather
  // than walking, which is the only way a headless tab can screenshot the meeting.
  const [walking, setWalking] = useState(delay === 0)
  useEffect(() => {
    if (delay === 0) return
    const timer = setTimeout(() => setWalking(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  const params = new URLSearchParams(location.search)
  const post = (at: number): ChatPost => ({ at, channelId: 'tech', threadId: null, mentions: [] })
  // One state for the whole team: the Sessions say it, except Blocked, which is a ticket.
  const session = (everyone && everyone !== 'blocked' ? everyone : 'busy') as SessionStatus
  // `?reading=1` puts every Session on a tool that only looks, which is the state that draws the
  // reading pose: a sheet of paper in both hands.
  const reading = Boolean(query.get('reading'))
  const scene = projectOffice({
    room,
    employees: team,
    bossSprite: Number(params.get('boss') ?? 0),
    // `?approval=1` is the visitor at the boss desk; a higher number adds that many sitters, who
    // find the one spot at the boss desk taken and put a hand up from their own chair instead.
    approvals: [
      ...(params.get('approval') && byName(visitor) ? [byName(visitor)!.id] : []),
      ...team
        .filter((e) => e.name !== visitor)
        .slice(0, Math.max(0, Number(params.get('approval') ?? 0) - 1))
        .map((e) => e.id),
    ].map((requesterId) => ({ requesterId, status: 'pending' as const })),
    sessions: Object.fromEntries(team.map((e) => [e.id, session])),
    // One live exchange that lasts well past the screenshot: the pair who walk in, or, with
    // `?meeting=<n>`, the first `n` of the sitters, however many chairs the table has.
    activity: reading
      ? Object.fromEntries(team.map((one) => [one.id, { tool: 'Read', posts: [] }]))
      : meeting
        ? // All at the one instant, so every one of them is already in the exchange at the screenshot.
          Object.fromEntries(team.slice(0, meeting).map((one) => [one.id, { tool: null, posts: [post(now)] }]))
        : walking && !everyone
          ? Object.fromEntries(
              TALKERS.flatMap((name, i) => {
                const one = byName(name)
                return one ? [[one.id, { tool: null, posts: [post(now + i)] }] as const] : []
              }),
            )
          : {},
    tickets: everyone
      ? team.map((e) => ({ assigneeId: e.id, blocked: everyone === 'blocked', column: 'doing' }))
      : meeting
        ? []
        : byName(blocked)
          ? [{ assigneeId: byName(blocked)!.id, blocked: true, column: 'doing' }]
          : [],
    now: now + Math.max(delay, 1),
  })
  return <Office scene={scene} company={{ name: 'Tiny Corp' }} />
}
