import {
  hasNotificationSettings,
  type NotificationDelivery,
  notificationSettingsPath,
} from '../../../shared/notifications'

/** What the settings row says about the last notification, and what it offers to do about it. */
export interface DeliveryMessage {
  /** One sentence the boss can act on. */
  text: string
  /**
   * The system is the one refusing **and** this platform has a pane to open about it, so the row
   * offers System Settings → Notifications. macOS and Windows have one; a Linux desktop has no
   * one place, and a link that opens nothing is worse than no link (T177).
   */
  systemSettings: boolean
  tone: 'neutral' | 'warning'
}

/**
 * Turns a delivery into what the Notifications row says (T126).
 *
 * `source` is where the delivery came from: `test` is the boss pressing Send a test notification,
 * and answers whatever happened, good news included; `remembered` is the last real notification,
 * which is worth a sentence only when it did not arrive — a row that announces every banner it
 * managed to post would say nothing the boss did not already see.
 *
 * **The one thing it never says is that a banner appeared** (T221). The desktop does not tell the
 * app that, so a test that the system took without complaint says exactly that and names the place
 * the boss can check for himself.
 */
export function deliveryMessage(
  delivery: NotificationDelivery | null,
  source: 'test' | 'remembered',
  platform: string = 'darwin',
): DeliveryMessage | null {
  if (!delivery) return null
  switch (delivery.status) {
    // A system that took it says nothing more, ever. Only the boss knows whether a banner came.
    case 'accepted':
      return source === 'test'
        ? {
            text: `The system took the banner and raised no objection. Whether one appeared is not something TinyCorp can see — if none did, check ${notificationSettingsPath(platform)}.`,
            systemSettings: hasNotificationSettings(platform),
            tone: 'neutral',
          }
        : null
    case 'unanswered':
      return source === 'test'
        ? {
            text: `The system said nothing at all about the banner, so TinyCorp cannot tell whether one appeared. Check ${notificationSettingsPath(platform)}.`,
            systemSettings: hasNotificationSettings(platform),
            tone: 'neutral',
          }
        : null
    case 'refused':
      return {
        text: `The system would not post it${said(delivery.reason)}. TinyCorp is not allowed to send notifications, so none of them arrive. Check ${notificationSettingsPath(platform)}.`,
        systemSettings: hasNotificationSettings(platform),
        tone: 'warning',
      }
    case 'unsupported':
      return {
        text: 'This system cannot post notifications at all, so nothing will arrive here.',
        systemSettings: false,
        tone: 'warning',
      }
    case 'off':
      return {
        text: 'Notifications are off for this Company, so none was sent. Turn them on, save, and try again.',
        systemSettings: false,
        tone: 'warning',
      }
  }
}

function said(reason: string | undefined): string {
  return reason ? ` — it said “${reason.replace(/\.$/, '')}”` : ''
}
