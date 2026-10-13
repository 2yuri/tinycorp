import { APP_NAME } from '../app/app-name'

/**
 * What a native notification is about. `asking` is a Session stopped in its terminal waiting for
 * the boss to answer it (T165); `test` is the banner the boss asks for himself (T126).
 */
export type NotificationKind =
  | 'approval'
  /** A drafted plan, or a replan, waiting for the boss to approve it or send it back (T233). */
  | 'plan'
  | 'asking'
  | 'mention'
  | 'pull_request'
  | 'budget'
  | 'digest'
  | 'test'

/**
 * What became of a notification the app handed to the system. A banner that never appears looks the
 * same as one that was never sent, so every send says which it was (T126).
 *
 * None of these says a banner **appeared**, because no desktop tells an app that (T221). The most
 * any of them claims is that the system took the request without complaining, which on macOS is
 * true of a notification the boss never sees — a Focus mode, an alert style of None, or an app the
 * system accepted but never registered all answer the same way as one that banners.
 */
export type NotificationDeliveryStatus =
  /**
   * The system took it and raised no objection. Whether anything appeared on screen is the one
   * thing TinyCorp cannot see: Electron's `show` fires when the request was accepted, milliseconds
   * later, and fires just the same when the banner is suppressed.
   */
  | 'accepted'
  /** The system neither took it nor refused it before the main process stopped waiting. */
  | 'unanswered'
  /** The system has notifications, and would not post this one — usually permission. */
  | 'refused'
  /** This platform, or this build, cannot post banners at all. */
  | 'unsupported'
  /** This Company has notifications turned off, so nothing was sent. */
  | 'off'

export interface NotificationDelivery {
  status: NotificationDeliveryStatus
  /** What the system said when it refused, where it said anything. */
  reason?: string
}

/** Where clicking a notification takes the boss. */
export type NotificationFocus =
  /**
   * A chat channel, with the thread of `threadId` open when it is not null, scrolled to `messageId`
   * — the message the notification is about — wherever in the channel or the thread it sits (T287).
   */
  | { kind: 'thread'; channelId: string; threadId: number | null; messageId?: number }
  /** An Employee's drawer. */
  | { kind: 'employee'; employeeId: string }
  /** A channel scrolled to the daily digest, with no thread opened: the digest has no thread (T172). */
  | { kind: 'digest'; channelId: string; messageId: number }

/**
 * A button on a notification, where the operating system shows them. `later` dismisses without
 * taking the boss anywhere, which is the only reason a banner needs a button that does nothing.
 */
export interface NotificationAction {
  id: 'approve' | 'reject' | 'open' | 'later'
  label: string
}

/** Something the boss should hear about while away from the app (design/html/notifications.html). */
export interface CompanyNotification {
  companyId: string
  kind: NotificationKind
  title: string
  body: string
  /** The requester's initials, or `!` for the budget: the designed icon. */
  icon: string
  focus: NotificationFocus
  /** Reject and Approve on an approval request, Later and Open digest on a digest (T172). */
  actions?: NotificationAction[]
  /** The Approval the actions decide. */
  approvalId?: number
}

/**
 * Whether this platform has a Notifications pane the app can open at all (T177).
 *
 * macOS and Windows each have one place, and `notificationSettingsUrl` in the main process knows
 * its URL. A Linux desktop has no one place — GNOME, KDE and XFCE each keep it somewhere else —
 * so the settings row offers no link there rather than one that silently does nothing. The two
 * sides read this, and a test holds them equal.
 */
export function hasNotificationSettings(platform: NodeJS.Platform | string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Where the boss goes to see, with their own eyes, whether this desktop lets TinyCorp post a banner
 * (T221). It is named in words rather than linked everywhere, because {@link hasNotificationSettings}
 * is false on Linux — there is a place to look there too, it is just not one URL the app can open.
 */
export function notificationSettingsPath(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return `System Settings → Notifications → ${APP_NAME}`
  if (platform === 'win32') return `Settings → System → Notifications → ${APP_NAME}, and Focus assist`
  return '‘Notifications’ in your desktop’s own settings'
}
