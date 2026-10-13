/**
 * What the coffee corner says about itself (T100).
 *
 * Where the floor packs people together, the place carries the label and the people in it carry
 * none. Six Employees at the counter stand a few pixels apart, so six labels reading `· Parked`
 * used to land on top of each other and none of them could be read. The corner says it once, over
 * the group, and each of them keeps the dimmed name on their own chair.
 */
import { type SpriteState, STATE_LABEL, STATE_PRECEDENCE } from './reading'

/** One person standing at the counter: the state that put them there, and what they would say. */
export interface AtTheCounter {
  state: SpriteState
  /** Their own reason, which is not always their state's: whoever has no desk is Working, and waiting. */
  reason?: string
}

/** What the corner calls itself; the count and the reason follow it. */
export const COUNTER_PLACE = 'At the counter'

/**
 * The counter's own label — `At the counter · 6 parked` — or null while nobody is standing there.
 *
 * The count is whoever is standing there, whatever put them there. Where they are mixed — some
 * parked, some blocked, some out of budget — the word is the largest group's and the count is still
 * all of them, so the corner reads as the thing it mostly is. A tie goes to whichever state the
 * room's own precedence reads first, so the same crowd always says the same thing.
 */
export function counterLabel(standing: (SpriteState | AtTheCounter)[]): string | null {
  if (standing.length === 0) return null
  const people = standing.map((one) => (typeof one === 'string' ? { state: one } : one))
  const state = largestGroup(people.map((one) => one.state))
  // An Employee the room had no desk for is Working, and standing here anyway: their own reason is
  // the true one, and saying `3 working` of a queue waiting for a desk would be a lie the room tells.
  const spoken = people.filter((one) => one.state === state).map((one) => one.reason)
  const said = spoken.find((reason) => reason && reason !== STATE_LABEL[state]) ?? STATE_LABEL[state]
  return `${COUNTER_PLACE} · ${people.length} ${said.toLowerCase()}`
}

/** The state most of them are in, ties broken by `STATE_PRECEDENCE`. */
function largestGroup(states: SpriteState[]): SpriteState {
  const counts = new Map<SpriteState, number>()
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1)
  const rank = (state: SpriteState) => STATE_PRECEDENCE.findIndex((row) => row.state === state)
  return [...counts].sort(([a, na], [b, nb]) => nb - na || rank(a) - rank(b))[0]![0]
}
