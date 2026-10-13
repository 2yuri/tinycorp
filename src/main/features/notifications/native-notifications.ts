import { Notification, nativeImage, shell } from 'electron'
import { APP_ID } from '../../../shared/app/app-name'
import {
  type CompanyNotification,
  hasNotificationSettings,
  type NotificationAction,
  type NotificationDelivery,
} from '../../../shared/notifications'
import { notificationIcon } from './notification-icon'

/**
 * How long the system gets to say what it did with a banner. Refusals come back at once — macOS
 * answers `addNotificationRequest` with an error the moment permission is missing — so a silence
 * this long is a system that never answered, which is its own {@link NotificationDelivery} status
 * and not a banner (T221).
 */
export const DELIVERY_TIMEOUT_MS = 4000

export interface ShowOptions {
  /** Play a sound is the boss's own setting, on Your profile (T79). */
  silent: boolean
  /** The boss clicked the banner itself. */
  click(): void
  /** The boss pressed one of the banner's buttons. */
  act(action: NotificationAction['id']): void
}

/** Shown notifications, kept so their click handlers are not garbage collected. */
const shown = new Set<Notification>()

/** Whether this platform and this build can post a banner at all. */
export function nativeNotificationsSupported(): boolean {
  return Notification.isSupported()
}

/**
 * Posts one banner and resolves with what became of it. `new Notification(...).show()` returns
 * nothing and throws nothing when the system refuses, which is why a banner that never appeared
 * used to look exactly like one that was never sent; Electron's `failed` event is the refusal, and
 * this turns it into an answer the boss can read (T126).
 *
 * **`show` is not a banner** (T221). Electron raises it the moment the desktop accepts the request
 * — measured at 4ms on macOS 15 against the packaged bundle id, with nothing at all on screen two
 * and a half seconds later. macOS presents or suppresses a notification long after it has taken
 * it, by a Focus mode, by the app's alert style, or by never having registered the app at all, and
 * it tells no one which. There is no Electron call for the authorisation status either, and the
 * system's own record of it (`~/Library/Group Containers/group.com.apple.usernoted`) is behind
 * Full Disk Access, so the app cannot go and look. `accepted` is therefore the most this can
 * honestly say, and the settings row says the rest.
 *
 * Nor does a permission prompt ever appear for this build: an ad-hoc signature is not an identity
 * Notification Center registers, so macOS answers a first `show()` either by accepting it silently
 * (this bundle id) or by refusing it outright with `UNErrorDomain 1`, "Notifications are not
 * allowed for this application" (a bundle id it has not seen). A Developer ID signature is what
 * turns that into a prompt and an entry in System Settings; decision 54 says there is none yet.
 */
export function showNativeNotification(
  notification: CompanyNotification,
  { silent, click, act }: ShowOptions,
): Promise<NotificationDelivery> {
  if (!nativeNotificationsSupported()) return Promise.resolve({ status: 'unsupported' })
  // macOS shows the first action as the button and the rest under it, so the primary Approve leads.
  const actions = [...(notification.actions ?? [])].reverse()
  // No Company subtitle: the design's banner is the title and the body (audit section 14).
  const native = new Notification({
    title: notification.title,
    body: notification.body,
    silent,
    ...(iconTile(notification.icon) ?? {}),
    actions: actions.map(({ label }) => ({ type: 'button' as const, text: label })),
  })
  shown.add(native)
  native.on('click', () => {
    shown.delete(native)
    click()
  })
  native.on('action', (_event, index) => {
    shown.delete(native)
    const action = actions[index]
    if (action) act(action.id)
  })
  native.on('close', () => shown.delete(native))

  return new Promise<NotificationDelivery>((resolve) => {
    let answered = false
    const answer = (delivery: NotificationDelivery) => {
      if (answered) return
      answered = true
      clearTimeout(timer)
      resolve(delivery)
    }
    const timer = setTimeout(() => answer({ status: 'unanswered' }), DELIVERY_TIMEOUT_MS)
    timer.unref?.()
    native.on('show', () => answer({ status: 'accepted' }))
    native.on('failed', (_event, error) => {
      shown.delete(native)
      answer({ status: 'refused', reason: String(error) })
    })
    native.show()
  })
}

/**
 * Opens the system's notification settings at this app, so the boss can turn the permission on
 * without hunting for it. Returns false where the platform has no such pane to open.
 */
export async function openNotificationSettings(): Promise<boolean> {
  const url = notificationSettingsUrl(process.platform)
  if (!url) return false
  await shell.openExternal(url)
  return true
}

/**
 * System Settings → Notifications, at this app's bundle id where the platform takes one. Null on a
 * Linux desktop, which has no one pane — and the settings row offers no link there either
 * ({@link hasNotificationSettings}).
 */
export function notificationSettingsUrl(platform: NodeJS.Platform): string | null {
  if (!hasNotificationSettings(platform)) return null
  return platform === 'darwin'
    ? `x-apple.systempreferences:com.apple.preference.notifications?id=${APP_ID}`
    : 'ms-settings:notifications'
}

/**
 * The designed initials tile for a notification, where the platform honours it. Electron reads
 * `icon` on Windows and Linux only; macOS draws the app icon itself (audit section 14).
 */
function iconTile(initials: string): { icon: Electron.NativeImage } | null {
  if (process.platform === 'darwin') return null
  const tile = notificationIcon(initials)
  return tile && { icon: nativeImage.createFromBitmap(tile.data, { width: tile.width, height: tile.height }) }
}
