import { BellRing } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { NotificationDelivery } from '../../../shared/notifications'
import { hostPlatform } from '../chrome'
import { Button, cx } from '../ui'
import { deliveryMessage } from './delivery-message'

const api = window.tinyCorp.notifications

/**
 * Send a test notification, and what became of it (T126). The toggle above it can look on while
 * macOS quietly drops every banner, because posting one returns nothing and throws nothing; this
 * row is the one thing that tells the boss whether the silence is the app's or the system's.
 */
export function NotificationCheckRow({
  delivery,
  source,
  testing,
  onTest,
  onOpenSystemSettings,
}: {
  /** What became of the last notification, or null when none has been handed to the system. */
  delivery: NotificationDelivery | null
  /** Whether `delivery` is the answer to a test the boss just asked for, or the last real one. */
  source: 'test' | 'remembered'
  testing: boolean
  onTest(): void
  onOpenSystemSettings(): void
}) {
  const message = deliveryMessage(delivery, source, hostPlatform())
  return (
    <div className="flex flex-col items-start gap-8">
      <Button
        variant="secondary"
        size="sm"
        icon={BellRing}
        disabled={testing}
        onClick={onTest}
        className="px-12 py-7 text-12-5/[normal]"
      >
        {testing ? 'Sending…' : 'Send a test notification'}
      </Button>
      {message && (
        <p
          className={cx(
            'm-0 text-11-5',
            message.tone === 'warning' ? 'text-status-warning-foreground' : 'text-muted-foreground',
          )}
          role="status"
        >
          {message.text}
          {message.systemSettings && (
            <>
              {' '}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 underline underline-offset-2 hover:text-foreground"
                onClick={onOpenSystemSettings}
              >
                Open System Settings → Notifications
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** The row, wired to the main process: it tests, and it remembers what the system last did. */
export function NotificationCheck() {
  /** What the main process last saw the system do, whether or not the boss asked. */
  const [remembered, setRemembered] = useState<NotificationDelivery | null>(null)
  /** The answer to the boss's own test, which outlives the next change broadcast. */
  const [tested, setTested] = useState<NotificationDelivery | null>(null)
  const [testing, setTesting] = useState(false)

  const read = useCallback(async () => {
    const result = await api.delivery()
    if (result.ok) setRemembered(result.value)
  }, [])

  useEffect(() => {
    void read()
    // A refusal the boss never asked about still reaches this row: every send records what it did.
    return api.onChanged(() => void read())
  }, [read])

  async function test() {
    if (testing) return
    setTesting(true)
    const result = await api.test()
    setTesting(false)
    setTested(result.ok ? result.value : { status: 'refused', reason: result.error })
  }

  return (
    <NotificationCheckRow
      delivery={tested ?? remembered}
      source={tested ? 'test' : 'remembered'}
      testing={testing}
      onTest={() => void test()}
      onOpenSystemSettings={() => void api.openSystemSettings()}
    />
  )
}
