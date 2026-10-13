import { notificationChannels } from '../../../shared/domain/channels'
import type { NotificationFocusRequest } from '../../../shared/ipc'
import type { CompanyNotification, NotificationAction, NotificationDelivery } from '../../../shared/notifications'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { NotificationsFacade } from './wire'

export interface NotificationIpcOptions {
  ipc: IpcHandlerRegistry
  engine: NotificationsFacade
  /**
   * Shows a native notification and answers with what the system did with it; `click` is called when
   * the boss clicks it, `act` when the boss presses one of its actions.
   */
  show(
    notification: CompanyNotification,
    click: () => void,
    act: (action: NotificationAction['id']) => void,
  ): Promise<NotificationDelivery>
  /** Whether this platform can post banners at all, asked before anything has been sent. */
  supported(): boolean
  /** Opens System Settings → Notifications at this app. False where the platform has no such pane. */
  openSystemSettings(): Promise<boolean>
  /** Brings the app forward and tells the renderer where to go. */
  focus(request: NotificationFocusRequest): void
  broadcastChanged(): void
  /** Where a failed click goes. Defaults to `console.warn`. */
  log?: (line: string) => void
}

/** Lets the renderer read and set the notification toggle, and turns engine notifications into native ones. */
export function registerNotificationIpc({
  ipc,
  engine,
  show,
  supported,
  openSystemSettings,
  focus,
  broadcastChanged,
  log = console.warn,
}: NotificationIpcOptions): void {
  /**
   * What became of the last banner handed to the system. A platform that cannot post at all is
   * known before anything is sent; everything else is learned from a notification, test or real,
   * so the settings row can say the system is the problem without the boss asking twice (T126).
   */
  let lastDelivery: NotificationDelivery | null = supported() ? null : { status: 'unsupported' }

  function record(delivery: NotificationDelivery): NotificationDelivery {
    const changed = lastDelivery?.status !== delivery.status || lastDelivery?.reason !== delivery.reason
    lastDelivery = delivery
    if (changed) broadcastChanged()
    return delivery
  }

  engine.onChange(broadcastChanged)
  engine.notifications.onNotify((notification) => {
    const { companyId } = notification
    const open = () => {
      const switched = attempt(() => engine.switchCompany(companyId))
      if (!switched.ok) log(`Notification: could not open Company ${companyId}: ${switched.error}`)
      return switched.ok
    }
    const click = () => {
      if (open()) focus({ companyId, focus: notification.focus })
    }
    // The delivery goes back to the engine, which hands it to whoever asked for the notification.
    return show(notification, click, (action) => {
      // Later is the one button that takes the boss nowhere: the digest waits in the channel (T172).
      if (action === 'later') return
      // Rejecting needs the boss's reason, so Reject opens the approval's thread to write it.
      if (action !== 'approve' || notification.approvalId === undefined) return click()
      if (!open()) return
      const decided = attempt(() => engine.approvals.decide(notification.approvalId!, { approve: true }))
      if (!decided.ok) {
        log(`Notification: could not approve ${notification.approvalId}: ${decided.error}`)
        focus({ companyId, focus: notification.focus })
      }
    }).then(record)
  })

  ipc.handle(notificationChannels.enabled, () => attempt(() => engine.notifications.enabled()))
  ipc.handle(notificationChannels.setEnabled, (_event, enabled) => {
    const result = attempt(() => engine.notifications.setEnabled(enabled as boolean))
    if (result.ok) broadcastChanged()
    return result
  })

  // The banner itself is recorded on its way out, by the listener above; a Company with
  // notifications off sends none, and that answer is the toggle's, not the system's.
  ipc.handle(notificationChannels.test, async () => {
    try {
      return { ok: true as const, value: await engine.notifications.sendTest() }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipc.handle(notificationChannels.delivery, () => attempt(() => lastDelivery))

  ipc.handle(notificationChannels.openSystemSettings, async () => {
    try {
      return { ok: true as const, value: await openSystemSettings() }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
