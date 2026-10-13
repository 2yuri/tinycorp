/**
 * Chat: the room itself, the composer, the cards a message is drawn as, and the Inbox list.
 *
 * The card shapes are here rather than in `src/shared` because they are a drawing, not a contract:
 * the office and the drawer show the same message and must show it the same way.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { ApprovalCard } from './ApprovalCard'
export { Chat } from './Chat'
export { Composer, type SlashComposer } from './Composer'
export {
  answererOf,
  approvalCard,
  type ChatData,
  companyKeyOf,
  formatTime,
  type MessageCard,
  nameOf,
  readOnlyNote,
  roleTag,
} from './chat-view'
export { useChannelDelete } from './DeleteChannel'
export { InboxList } from './InboxList'
export type { Refs } from './Messages'
export { useChatData } from './use-chat-data'
export { useSlashComposer } from './use-slash'
