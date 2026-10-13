/** Types for `tools/bench/dm.mjs`: the DM thread two Employees share in a `duo` cell (T197). */

/** Each description in the pieces the app builds its own from, each one contiguous in its source. */
export const CHAT_TOOL_PARTS: Record<string, readonly string[]>

/** What an Employee reads about each chat tool, word for word from the app's own server. */
export const CHAT_TOOLS: {
  channelHelp: string
  chat_post: string
  chat_read: string
  thread_reply: string
}

export const DM_CHANNEL: string

export function resolveChannel(where: string, who: { me: string; peer: string }): string

/** One message, as the file keeps it. */
export interface DmMessage {
  id: number
  author: string
  channelId: string
  text: string
  threadId: number | null
  at: string
}

export function dmRecord(message: {
  id: number
  author: string
  channelId: string
  text: string
  threadId?: number | null
  at?: string
}): DmMessage

export function readDm(text: string): DmMessage[]
export function viewMessage(message: DmMessage): {
  id: number
  author: string
  text: string
  thread_id?: number
  at: string
}

/** How much prose the thread carried, per author and in all. */
export function dmTraffic(messages: readonly DmMessage[]): {
  messages: number
  chars: number
  words: number
  estTokens: number
  elsewhere: number
  byAuthor: Record<string, { messages: number; chars: number; words: number; estTokens: number }>
}
