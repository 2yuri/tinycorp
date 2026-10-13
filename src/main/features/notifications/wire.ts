import type { Approval } from '../../../shared/approvals'
import type { Company } from '../../../shared/company'
import type { Mentionable } from '../../../shared/domain/chat'
import type { Plan } from '../../../shared/planning/planning'
import type { CompanyContext, OpenCompany } from '../../core'
import type { Approvals } from '../approvals'
import type { CompanyChanged } from '../company'
import { createNotifications, type NotificationService, type Notifications } from './notifications'

/**
 * The other features a notification reads before it says anything: who the Company's people are,
 * so it can name them, and what is waiting on the boss, so a message that opened an Approval rings
 * as an Approval rather than as a mention.
 */
export interface NotificationsDeps {
  /** Who can be named in that Company, and who each thread belongs to. */
  chat(entry: OpenCompany): {
    people(): Mentionable[]
    threadAudience(threadId: number): { authorId: string; mentioned: string[] } | null
  }
  /** What is waiting on the boss there. */
  approvals(entry: OpenCompany): { list(filter: { status: 'pending' }): Approval[] }
  /** That Company's plans, so a drafted plan rings as the decision it is rather than as a mention. */
  planning(entry: OpenCompany): { list(): Plan[] }
}

/** The notifications feature, once it is wired. */
export interface NotificationsFeature {
  notifications: NotificationService
  /** The Notifications settings pane's own half: the toggle, the test and the listener. */
  facade: Pick<NotificationsFacade, 'notifications'>
}

/**
 * Wires notifications to the Companies the app has open (T186).
 *
 * A notification is always about one Company — the boss can have several open — so every send starts
 * from an id and stops there when that Company is gone. Nothing is kept per Company: the toggle is a
 * row in that Company's own database and the listeners belong to the app.
 */
export function register(ctx: CompanyContext, deps: NotificationsDeps): NotificationsFeature {
  const notifications = createNotifications({
    current: () => ctx.currentEntry().db,
    currentId: () => ctx.currentEntry().company.id,
    company(companyId) {
      const found = ctx.entryOf(companyId)
      return found
        ? {
            name: found.company.name,
            db: found.db,
            people: () => deps.chat(found).people(),
            pendingApprovals: () => deps.approvals(found).list({ status: 'pending' }),
            plans: () => deps.planning(found).list(),
            thread: (threadId) => deps.chat(found).threadAudience(threadId),
          }
        : null
    },
  })

  return {
    notifications,
    facade: {
      notifications: {
        enabled: () => notifications.enabled(),
        setEnabled: (enabled) => notifications.setEnabled(enabled),
        onNotify: (listener) => notifications.onNotify(listener),
        sendTest: () => notifications.sendTest(),
      },
    },
  }
}

/**
 * The notifications face.
 *
 * Wider than the toggle alone: clicking a notification switches to the Company it was about and, for
 * an Approval, opens it — so the face carries the two reads that click needs and nothing else.
 */
export interface NotificationsFacade extends CompanyChanged {
  notifications: Notifications
  approvals: Approvals
  switchCompany(id: string): Company
}
