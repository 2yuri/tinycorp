/** The conversations of one Employee: what the Employee drawer's Chats tab lists (T72). */

/** The newest message of a conversation, as its row previews it. */
export interface ConversationPreview {
  id: number
  /** `BOSS`, `COMPANY_AUTHOR` or an Employee id. */
  authorId: string
  text: string
  createdAt: string
}

/** One conversation an Employee takes part in: a named channel, or a DM with the boss or a teammate. */
export interface EmployeeConversation {
  channelId: string
  kind: 'channel' | 'dm'
  /** A named channel's name (`tech`); empty for a DM. */
  name: string
  /** A DM's two participants; empty for a named channel. */
  members: string[]
  /** The other side of a DM — `BOSS` or an Employee id; null for a named channel. */
  counterpartId: string | null
  /** The newest message; a conversation with none is not listed. */
  last: ConversationPreview
  /** Messages in it the boss has not read, their own left out. */
  unread: number
  /** Whether the boss takes part, so may post here. False for a DM between two Employees. */
  postable: boolean
}
