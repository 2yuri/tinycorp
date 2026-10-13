/**
 * The inbox: what is waiting for an Employee, and what is waiting for the boss.
 *
 * The feature's front door. Every wake an Employee gets is an item here first — a DM, a mention, a
 * ticket it holds, an approval decided — and the item is pushed to it when it is idle and read
 * when it wakes. Who answers a boss message that addresses nobody is the same question asked from
 * the other side (decision 41), so the answerer lives here too; the boss's own Inbox is the rows
 * addressed to them (decision 43). What an item *is* is in `src/shared/inbox`.
 */

export { ANSWERER_MIGRATION } from './answerer'
export { registerAnswererIpc } from './answerer-ipc'
export { type BossInbox, createBossInbox } from './boss-inbox'
export { INBOX_MIGRATION, type NewInboxItem, type WakeContext } from './inbox'
export { registerInboxIpc } from './ipc'
export type { AnswererFacade, InboxFacade } from './wire'
export { register as registerInbox } from './wire'
