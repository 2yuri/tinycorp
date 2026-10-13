import { describe, expect, it, vi } from 'vitest'
import { type CompanyNotification, hasNotificationSettings } from '../../../shared/notifications'

type Listener = (event: unknown, ...args: unknown[]) => void

/** Stands in for Electron's Notification: it records what it was given and fires no event by itself. */
class FakeNotification {
  static supported = true
  static shown: FakeNotification[] = []
  static isSupported(): boolean {
    return FakeNotification.supported
  }
  readonly listeners = new Map<string, Listener[]>()
  displayed = 0
  constructor(readonly options: Record<string, unknown>) {}
  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  show(): void {
    this.displayed++
    FakeNotification.shown.push(this)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener({}, ...args)
  }
}

const opened: string[] = []

vi.mock('electron', () => ({
  Notification: FakeNotification,
  nativeImage: { createFromBitmap: () => ({}) },
  shell: {
    openExternal: (url: string) => {
      opened.push(url)
      return Promise.resolve()
    },
  },
}))

const { showNativeNotification, openNotificationSettings, notificationSettingsUrl, DELIVERY_TIMEOUT_MS } = await import(
  './native-notifications'
)

const notification: CompanyNotification = {
  companyId: 'c1',
  kind: 'test',
  title: 'Test notification',
  body: 'This is a test.',
  icon: 'AC',
  focus: { kind: 'thread', channelId: 'general', threadId: null },
}

function show(
  overrides: Partial<Parameters<typeof showNativeNotification>[1]> = {},
  what: CompanyNotification = notification,
) {
  FakeNotification.shown = []
  const clicks: number[] = []
  const acted: string[] = []
  const delivery = showNativeNotification(what, {
    silent: false,
    click: () => clicks.push(1),
    act: (action) => acted.push(action),
    ...overrides,
  })
  return { delivery, native: FakeNotification.shown[0], clicks, acted }
}

describe('Native notifications', () => {
  /**
   * Electron's `show` is the desktop accepting the request, not a banner on screen: on macOS it
   * fires milliseconds later whether or not anything is presented (T221). So the answer is
   * `accepted`, and nothing downstream is allowed to read a banner into it.
   */
  it('answers that the system accepted it — never that a banner appeared', async () => {
    const { delivery, native } = show()

    native!.emit('show')

    expect(await delivery).toEqual({ status: 'accepted' })
  })

  it('answers a refusal with what the system said, rather than with silence', async () => {
    const { delivery, native } = show()

    native!.emit('failed', 'Notifications are not allowed for this application')

    expect(await delivery).toEqual({
      status: 'refused',
      reason: 'Notifications are not allowed for this application',
    })
  })

  it('says a system that never answered never answered, rather than calling the silence a banner', async () => {
    vi.useFakeTimers()
    try {
      const { delivery } = show()
      vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS)

      expect(await delivery).toEqual({ status: 'unanswered' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the first answer when the system answers twice', async () => {
    const { delivery, native } = show()

    native!.emit('failed', 'no')
    native!.emit('show')

    expect(await delivery).toEqual({ status: 'refused', reason: 'no' })
  })

  it('posts nothing, and says so, where the platform has no notifications', async () => {
    FakeNotification.supported = false
    try {
      const { delivery, native } = show()

      expect(await delivery).toEqual({ status: 'unsupported' })
      expect(native).toBeUndefined()
    } finally {
      FakeNotification.supported = true
    }
  })

  it('still routes the click and the buttons of a banner it posted, Approve leading', async () => {
    const approval: CompanyNotification = {
      ...notification,
      kind: 'approval',
      actions: [
        { id: 'reject', label: 'Reject' },
        { id: 'approve', label: 'Approve' },
      ],
    }
    const { delivery, native, clicks, acted } = show({}, approval)
    native!.emit('show')
    await delivery

    native!.emit('click')
    native!.emit('action', 0)
    native!.emit('action', 1)

    expect(native!.options['actions']).toEqual([
      { type: 'button', text: 'Approve' },
      { type: 'button', text: 'Reject' },
    ])
    expect(clicks).toEqual([1])
    expect(acted).toEqual(['approve', 'reject'])
  })

  it('opens System Settings at this app on macOS, and has no pane to open on Linux', async () => {
    expect(notificationSettingsUrl('darwin')).toBe(
      'x-apple.systempreferences:com.apple.preference.notifications?id=dev.tinycorp.app',
    )
    expect(notificationSettingsUrl('win32')).toBe('ms-settings:notifications')
    expect(notificationSettingsUrl('linux')).toBeNull()
  })

  it('hands the settings URL to the shell on the platforms that have one', async () => {
    opened.length = 0

    const handled = await openNotificationSettings()

    expect(handled).toBe(notificationSettingsUrl(process.platform) !== null)
    expect(opened).toEqual(handled ? [notificationSettingsUrl(process.platform)] : [])
  })
})

/**
 * The renderer decides whether to offer the System Settings link and the main process decides
 * whether opening it does anything; they have to agree, or a Linux boss gets a link that silently
 * does nothing (T177).
 */
describe('the notifications pane', () => {
  it('is offered by the row exactly where the main process can open one', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as NodeJS.Platform[]) {
      expect(hasNotificationSettings(platform)).toBe(notificationSettingsUrl(platform) !== null)
    }
  })
})
