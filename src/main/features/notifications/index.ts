/**
 * Notifications: what the desktop is told, and when.
 *
 * The feature's front door. Everything another module may name is here — the migration, the wiring,
 * the IPC module and the native banners — and nothing else in this folder is reached from outside
 * it (`ARCHITECTURE.md`, rule 3).
 */

export { registerNotificationIpc } from './ipc'
export { nativeNotificationsSupported, openNotificationSettings, showNativeNotification } from './native-notifications'
export { NOTIFICATIONS_MIGRATION, type OpenedPullRequest } from './notifications'
export type { NotificationsFacade } from './wire'
export { register as registerNotifications } from './wire'
