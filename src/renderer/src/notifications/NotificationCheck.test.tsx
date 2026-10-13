import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { NotificationDelivery } from '../../../shared/notifications'

let NotificationCheckRow: typeof import('./NotificationCheck').NotificationCheckRow

beforeAll(async () => {
  // The row reads the preload API when its module loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { notifications: {} } }
  ;({ NotificationCheckRow } = await import('./NotificationCheck'))
})

function render(delivery: NotificationDelivery | null, source: 'test' | 'remembered' = 'test', testing = false) {
  return renderToStaticMarkup(
    <NotificationCheckRow
      delivery={delivery}
      source={source}
      testing={testing}
      onTest={() => {}}
      onOpenSystemSettings={() => {}}
    />,
  )
}

describe('The Notifications row', () => {
  it('offers to send a test notification, and says nothing before one is sent', () => {
    const html = render(null)

    expect(html).toContain('Send a test notification')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('System Settings')
  })

  /**
   * The row the boss actually read when he pressed the button and no banner came (T221). It may
   * say the system took it; it may never say a banner appeared, and it has to name the one place
   * he can go and find out.
   */
  it('says only that the system took it, and sends the boss to System Settings to check', () => {
    const html = render({ status: 'accepted' })

    expect(html).toContain('The system took the banner and raised no objection')
    expect(html).toContain('not something TinyCorp can see')
    expect(html).not.toContain('showed the banner')
    expect(html).not.toContain('Notifications reach you')
    expect(html).toContain('Open System Settings → Notifications')
    expect(html).not.toContain('text-status-warning-foreground')
  })

  it('says the system refused it, quotes the reason, and offers System Settings', () => {
    const html = render({ status: 'refused', reason: 'Notifications are not allowed for this application' })

    expect(html).toContain('The system would not post it')
    expect(html).toContain('Notifications are not allowed for this application')
    expect(html).toContain('Open System Settings → Notifications')
    expect(html).toContain('text-status-warning-foreground')
  })

  it('says so for a refusal the boss never asked about, without a test of his own', () => {
    const html = render({ status: 'refused' }, 'remembered')

    expect(html).toContain('The system would not post it.')
    expect(html).toContain('Open System Settings → Notifications')
  })

  it('offers no System Settings where the platform has no notifications at all', () => {
    const html = render({ status: 'unsupported' })

    expect(html).toContain('This system cannot post notifications at all')
    expect(html).not.toContain('System Settings')
  })

  it('points at the toggle, not the system, when this Company has notifications off', () => {
    const html = render({ status: 'off' })

    expect(html).toContain('Notifications are off for this Company')
    expect(html).not.toContain('System Settings')
  })

  it('says it is sending while a test is in flight, and takes no second press', () => {
    const html = render(null, 'test', true)

    expect(html).toContain('Sending…')
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })
})
