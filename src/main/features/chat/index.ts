/**
 * Chat: channels, DMs, threads, read marks and the files a message carries.
 *
 * The feature's front door. Every Employee and the boss are in the same rooms, and a post is the
 * event the office, the Inbox, the wakes and the activity log all hang off — which is why a chat is
 * made with the callbacks that say so rather than polled. Attachments live in the Company folder,
 * under the message that carries them (decision 37). The colleague voice is one Company-wide
 * setting, because both sides of a DM have to agree on it (T180).
 */

export { ATTACHMENTS_MIGRATION } from './attachments'
export { CHANNEL_EXTRAS_MIGRATION } from './channel-extras'
export {
  CHAT_MIGRATION,
  type Chat,
  MESSAGE_TARGET_MIGRATION,
  MESSAGE_TEST_RUN_MIGRATION,
} from './chat'
export { CHAT_DRAFTS_MIGRATION } from './chat-drafts'
export { CHAT_READ_MARKS_MIGRATION } from './chat-read-marks'
export type { ChatFacade, VoiceFacade } from './facade'
export { registerChatIpc } from './ipc'
export { registerChatTools } from './tools'
export { registerVoiceIpc } from './voice-ipc'
export { type ChatOptions, register as registerChat } from './wire'
