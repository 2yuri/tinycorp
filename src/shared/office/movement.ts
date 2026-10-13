/**
 * Why an Employee leaves their desk, and for how long. Pure: the only input is the chat posts the
 * engine kept for each Employee, so the same facts always produce the same trips (T74).
 *
 * A trip needs a cause someone can read off the screen:
 * - a **meeting** is a live exchange in one channel or thread with at least two Employees in it;
 *   one Employee posting alone never leaves their desk;
 * - a **visit** to a colleague's desk is a DM to them, or an `@Name` in a channel;
 * - the **boss desk** is a DM to the boss or an `@boss`.
 *
 * A trip lasts as long as its exchange stays live plus a short tail, never less than `MIN_TRIP_MS`,
 * and an Employee starts at most one trip per `TRIP_GAP_MS`, so the room reads calm.
 */
import { BOSS, CHANNEL_MENTION, dmMembers } from '../domain/chat'

/** One chat post, as the office remembers it. */
export interface ChatPost {
  /** Epoch ms. */
  at: number
  channelId: string
  /** The thread it belongs to, or null for a top-level message. */
  threadId: number | null
  /** Participants `@`-mentioned: Employee ids, and `BOSS` for `@boss`. */
  mentions: string[]
}

/** Where a trip goes: the meeting room, a colleague's desk, or the boss desk. */
export type TripPlace = 'meeting' | 'desk' | 'boss'

export interface Trip {
  place: TripPlace
  /** The other Employees the trip is about: the meeting's other participants, or the colleague visited. */
  withIds: string[]
  startedAt: number
  /** When the Employee walks back. */
  endsAt: number
  /**
   * The exchange the trip came from. Everyone the same exchange sends to the meeting room carries
   * the same one, which is how the office knows a meeting is one set of Employees and not a claim
   * each of them makes on their own (T92).
   */
  exchangeId: string
}

/** How long after a post the exchange it belongs to is still live. */
export const EXCHANGE_MS = 120_000

/** How long an Employee stays on after their exchange goes quiet. */
export const TAIL_MS = 20_000

/** No trip is shorter than this, however short the exchange was. */
export const MIN_TRIP_MS = 20_000

/** At most one trip per Employee per this long. */
export const TRIP_GAP_MS = 60_000

/** How long the office keeps a post; older ones cause nothing. */
export const POST_MEMORY_MS = 10 * 60_000

interface AuthoredPost extends ChatPost {
  employeeId: string
}

/** A run of posts in one channel or thread, each within `EXCHANGE_MS` of the one before. */
interface Exchange {
  /** Tells this run of posts from every other one in this reading. */
  id: string
  channelId: string
  posts: AuthoredPost[]
  /** When the last post landed. */
  lastAt: number
}

/**
 * The trip each Employee is on at `now`, by Employee id; Employees with nothing to do are absent.
 * `posts` is by Employee id, and ids that are not in `employeeIds` are ignored (someone left).
 */
export function officeTrips(
  posts: Record<string, ChatPost[]>,
  employeeIds: ReadonlySet<string>,
  now: number,
): Map<string, Trip> {
  const authored = Object.entries(posts)
    .filter(([employeeId]) => employeeIds.has(employeeId))
    .flatMap(([employeeId, list]) => list.map((post): AuthoredPost => ({ ...post, employeeId })))
    .filter((post) => post.at > now - POST_MEMORY_MS)
    .sort((a, b) => a.at - b.at)

  const candidates = new Map<string, Trip[]>()
  const offer = (employeeId: string, trip: Trip) => {
    const ends = Math.max(trip.endsAt, trip.startedAt + MIN_TRIP_MS)
    candidates.set(employeeId, [...(candidates.get(employeeId) ?? []), { ...trip, endsAt: ends }])
  }

  for (const exchange of exchanges(authored)) {
    const endsAt = exchange.lastAt + EXCHANGE_MS + TAIL_MS
    const members = dmMembers(exchange.channelId)
    if (members) {
      for (const { employeeId, trip } of dmTrips(exchange, members, employeeIds)) offer(employeeId, { ...trip, endsAt })
      continue
    }
    const speakers = [...new Set(exchange.posts.map((p) => p.employeeId))]
    if (speakers.length > 1) {
      // A real conversation: everyone in it sits down together, from the post that made it one.
      const became = exchange.posts.find((p) => p.employeeId !== exchange.posts[0]!.employeeId)!.at
      for (const employeeId of speakers) {
        const mine = exchange.posts.find((p) => p.employeeId === employeeId)!.at
        offer(employeeId, {
          place: 'meeting',
          withIds: speakers.filter((id) => id !== employeeId),
          startedAt: Math.max(mine, became),
          endsAt,
          exchangeId: exchange.id,
        })
      }
      continue
    }
    // Alone in the channel: an `@Name` still sends them over, anything else keeps them seated.
    for (const post of exchange.posts) {
      const mention = post.mentions.find(
        (id) => id !== CHANNEL_MENTION && id !== post.employeeId && (id === BOSS || employeeIds.has(id)),
      )
      if (!mention) continue
      offer(post.employeeId, {
        place: mention === BOSS ? 'boss' : 'desk',
        withIds: mention === BOSS ? [] : [mention],
        startedAt: post.at,
        endsAt,
        exchangeId: exchange.id,
      })
    }
  }

  const trips = new Map<string, Trip>()
  for (const [employeeId, offered] of candidates) {
    const active = cadence(offered).findLast((trip) => trip.startedAt <= now && now < trip.endsAt)
    if (active) trips.set(employeeId, active)
  }
  return trips
}

/** Splits posts into the runs that count as one exchange: same channel and thread, no gap over `EXCHANGE_MS`. */
function exchanges(posts: AuthoredPost[]): Exchange[] {
  const found = new Map<string, Exchange[]>()
  for (const post of posts) {
    const key = `${post.channelId}::${post.threadId ?? 0}`
    const runs = found.get(key) ?? []
    const open = runs.at(-1)
    if (open && post.at - open.lastAt <= EXCHANGE_MS) {
      open.posts.push(post)
      open.lastAt = post.at
    } else {
      runs.push({ id: `${key}#${runs.length}`, channelId: post.channelId, posts: [post], lastAt: post.at })
    }
    found.set(key, runs)
  }
  return [...found.values()].flat()
}

/**
 * A DM is a visit, never a meeting: whoever opened the exchange walks over, and the one they came to
 * stays in their chair. A DM with the boss sends the Employee to the boss desk.
 */
function dmTrips(
  exchange: Exchange,
  members: string[],
  employeeIds: ReadonlySet<string>,
): { employeeId: string; trip: Trip }[] {
  const opener = exchange.posts[0]!
  const other = members.find((id) => id !== opener.employeeId)
  const trip = { withIds: [] as string[], startedAt: opener.at, endsAt: 0, exchangeId: exchange.id }
  if (other === BOSS) return [{ employeeId: opener.employeeId, trip: { ...trip, place: 'boss' } }]
  if (!other || !employeeIds.has(other)) return []
  return [{ employeeId: opener.employeeId, trip: { ...trip, place: 'desk', withIds: [other] } }]
}

/** The trips an Employee is allowed to make, oldest first: one per `TRIP_GAP_MS`, the rest dropped. */
function cadence(offered: Trip[]): Trip[] {
  const kept: Trip[] = []
  for (const trip of [...offered].sort((a, b) => a.startedAt - b.startedAt)) {
    const last = kept.at(-1)
    if (!last || trip.startedAt - last.startedAt >= TRIP_GAP_MS) kept.push(trip)
  }
  return kept
}
