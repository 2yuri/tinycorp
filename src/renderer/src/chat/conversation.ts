// What the Inbox's right-hand panel shows for the row the boss opened (T251). Pure, so the rules
// are tested without a DOM.
import { BOSS, type Channel, dmMembers, type Message } from '../../../shared/domain/chat'
import { type DraftKey, draftKeys } from '../../../shared/drafts'
import type { BossInboxItem } from '../../../shared/inbox/boss-inbox'
import { type ChatData, nameOf } from './chat-view'

/** The conversation a row lives in, and how the panel draws and answers it. */
export interface Conversation {
  /** The messages, oldest first: a thread from its root, or the channel's own history. */
  messages: Message[]
  /** True when those messages are a thread, so an answer is a reply rather than a new message. */
  inThread: boolean
  /** The channel the conversation is in, which is where a new message goes. */
  channelId: string
  /** The thread a reply answers, or null when the conversation is the channel's own history. */
  rootId: number | null
  /** The message the row is about: it is highlighted, and the panel opens scrolled to it. */
  messageId: number
  /**
   * The first message the boss had not read when they opened the row, before which the red New
   * divider sits; 0 when there is none. It is read from the mark as it stood *before* the row was
   * opened, because opening one marks its channel read and the divider would vanish on the first
   * render otherwise.
   */
  firstUnreadId: number
  /** `Vega`, `#general`, `Thread in #tech`. */
  title: string
  /** `Direct message · the whole conversation`. */
  origin: string
  /** `Message Vega…`, `Reply in thread…`. */
  placeholder: string
  /** The composer's saved draft: the thread's, or the channel's own. */
  draftKey: DraftKey
}

/** What the panel reads besides the row itself. */
export interface ConversationParts {
  /** The channel's top-level messages, oldest first. */
  history: Message[]
  /** The row's thread: its root and its replies, or just the root when it has none. */
  thread: Message[]
  channels: Channel[]
  /** The channel's read mark as it stood before the row was opened; 0 for a channel never read. */
  readMark: number
}

/**
 * The conversation a row opens.
 *
 * It is the row's **thread** when the message is a reply or has replies of its own, and the
 * channel's **own history** when it is a top-level message that nobody has answered — which is
 * what a DM is, and what a mention in a quiet channel is. Before T251 every row opened its thread,
 * so a DM showed one message with nothing around it.
 */
export function conversationOf(item: BossInboxItem, parts: ConversationParts, data: ChatData): Conversation {
  const reply = item.threadId !== item.messageId
  // A DM the boss was sent is read as the DM, not as a thread of one; a reply inside one is still
  // a thread, because that is where an answer to it goes.
  const inThread = reply || (item.kind !== 'dm' && parts.thread.length > 1)
  const messages = inThread ? parts.thread : parts.history
  const dm = dmMembers(item.channelId)
  const channel = parts.channels.find((c) => c.id === item.channelId)
  const name = dm
    ? dm
        .filter((member) => member !== BOSS)
        .map((id) => nameOf(id, data.employees))
        .join(' ↔ ')
    : `#${channel?.name ?? item.channelId}`
  const place = dm ? 'Direct message' : name
  return {
    messages,
    inThread,
    channelId: item.channelId,
    rootId: inThread ? item.threadId : null,
    messageId: item.messageId,
    firstUnreadId: messages.find((message) => message.id > parts.readMark)?.id ?? 0,
    title: inThread ? `Thread in ${name}` : name,
    origin: `${place} · the whole ${inThread ? 'thread' : 'conversation'}`,
    placeholder: inThread ? 'Reply in thread…' : `Message ${name}…`,
    draftKey: inThread ? draftKeys.thread(item.threadId) : draftKeys.channel(item.channelId),
  }
}
