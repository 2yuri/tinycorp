// What the drawer's Chats tab shows, derived from engine data. Pure, so the rules are tested without a DOM.
import { BOSS } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { EmployeeConversation } from '../../../shared/employee-chats'
import { formatTime, nameOf, readOnlyNote, roleTag } from '../chat'

/** One row of the conversations list (design/html/employee-drawer-chats.html: Conversations). */
export interface ConversationRow {
  channelId: string
  /** `Vega` for a teammate's DM, `You` for the boss's, `#tech` for a channel. */
  title: string
  /** The counterpart's role tag (`FRONTEND`, `BOSS`); empty for a channel. */
  role: string
  /** Who the row's avatar stands for; null for a channel, which draws a `#` tile instead. */
  avatarId: string | null
  /** The newest message, the author named when several people speak there. */
  preview: string
  /** `09:47`. */
  time: string
  unread: boolean
}

/** The rows the engine's conversations become, in the order the engine gave them: newest first. */
export function conversationRows(conversations: EmployeeConversation[], employees: Employee[]): ConversationRow[] {
  return conversations.map((conversation) => {
    const dm = conversation.counterpartId
    const author = nameOf(conversation.last.authorId, employees)
    return {
      channelId: conversation.channelId,
      title: dm === null ? `#${conversation.name}` : nameOf(dm, employees),
      role: dm === null ? '' : roleTag(dm, employees),
      avatarId: dm,
      preview: dm === null ? `${author}: ${conversation.last.text}` : conversation.last.text,
      time: formatTime(conversation.last.createdAt),
      unread: conversation.unread > 0,
    }
  })
}

/** The count on the Chats tab: every message in these conversations the boss has not read. */
export function unreadTotal(conversations: EmployeeConversation[]): number {
  return conversations.reduce((sum, conversation) => sum + conversation.unread, 0)
}

/** The conversation the tab opens on: the one the route names, else the newest. */
export function selectedConversation(
  conversations: EmployeeConversation[],
  channelId: string | null,
): EmployeeConversation | null {
  return conversations.find((c) => c.channelId === channelId) ?? conversations[0] ?? null
}

/** The head and the foot of the read-along pane. */
export interface ReadAlong {
  /** `Nova and Vega`, `Nova and you`, or `#tech`. */
  title: string
  /** The note at the right of the head; empty when the boss can post. */
  note: string
  /** The read-only banner, or null when the boss takes part and the composer is shown instead. */
  banner: string | null
}

export function readAlong(conversation: EmployeeConversation, employee: Employee, employees: Employee[]): ReadAlong {
  const dm = conversation.counterpartId
  const title =
    dm === null ? `#${conversation.name}` : `${employee.name} and ${dm === BOSS ? 'you' : nameOf(dm, employees)}`
  if (conversation.postable) return { title, note: '', banner: null }
  return {
    title,
    note: 'You can read along',
    banner: readOnlyNote([employee.name]),
  }
}
