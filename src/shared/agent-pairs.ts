/** The DMs two Employees hold with each other: what the sidebar's Between agents section lists (T77). */

/** One conversation between two Employees, the boss left out. A pair with no message is not listed. */
export interface AgentPair {
  channelId: string
  /** The two Employee ids, sorted, as the DM's id holds them. */
  members: string[]
  /** When the newest message landed, so the section can order most recent first. */
  lastAt: string
  /** Messages in it the boss has not read. */
  unread: number
}
