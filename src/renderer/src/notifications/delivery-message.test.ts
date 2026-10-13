import { describe, expect, it } from 'vitest'
import { deliveryMessage } from './delivery-message'

describe('What the Notifications row says about a delivery', () => {
  it('says nothing before anything has been sent', () => {
    expect(deliveryMessage(null, 'test')).toBeNull()
    expect(deliveryMessage(null, 'remembered')).toBeNull()
  })

  /**
   * The bug this row exists to prevent, told by the row itself (T221). Electron's `show` event is
   * the desktop accepting the request, and macOS raises it in milliseconds for a notification it
   * then suppresses — so the old sentence, "The system showed the banner. Notifications reach
   * you.", was a claim the app had no way to make. Nothing it says now asserts a banner appeared.
   */
  it('never claims a banner appeared, and names where the boss can check', () => {
    const message = deliveryMessage({ status: 'accepted' }, 'test', 'darwin')

    expect(message).toEqual({
      text: 'The system took the banner and raised no objection. Whether one appeared is not something TinyCorp can see — if none did, check System Settings → Notifications → TinyCorp.',
      systemSettings: true,
      tone: 'neutral',
    })
    for (const platform of ['darwin', 'win32', 'linux']) {
      const text = deliveryMessage({ status: 'accepted' }, 'test', platform)?.text ?? ''
      expect(text).not.toMatch(/showed the banner|Notifications reach you/)
    }
  })

  it('keeps quiet about real notifications the system took, which the boss either saw or did not', () => {
    expect(deliveryMessage({ status: 'accepted' }, 'remembered')).toBeNull()
    expect(deliveryMessage({ status: 'unanswered' }, 'remembered')).toBeNull()
  })

  /**
   * A desktop that answers neither `show` nor `failed` within the timeout told us nothing, which is
   * a third thing — not a refusal, and certainly not a banner (T221).
   */
  it('says a silent system was silent, and sends the boss to look', () => {
    expect(deliveryMessage({ status: 'unanswered' }, 'test', 'win32')).toEqual({
      text: 'The system said nothing at all about the banner, so TinyCorp cannot tell whether one appeared. Check Settings → System → Notifications → TinyCorp, and Focus assist.',
      systemSettings: true,
      tone: 'neutral',
    })
  })

  /** Linux has no pane to open, so the sentence has to carry the whole of the advice (T177, T221). */
  it('names a place to check on Linux too, where there is no link to offer', () => {
    expect(deliveryMessage({ status: 'accepted' }, 'test', 'linux')).toEqual({
      text: 'The system took the banner and raised no objection. Whether one appeared is not something TinyCorp can see — if none did, check ‘Notifications’ in your desktop’s own settings.',
      systemSettings: false,
      tone: 'neutral',
    })
  })

  it('names the refusal, quotes what the system said, and offers System Settings', () => {
    const message = deliveryMessage(
      { status: 'refused', reason: 'Notifications are not allowed for this application.' },
      'test',
    )

    expect(message).toEqual({
      text: 'The system would not post it — it said “Notifications are not allowed for this application”. TinyCorp is not allowed to send notifications, so none of them arrive. Check System Settings → Notifications → TinyCorp.',
      systemSettings: true,
      tone: 'warning',
    })
  })

  it('says a refusal without a reason too, and says it for a real notification as well', () => {
    expect(deliveryMessage({ status: 'refused' }, 'remembered')).toEqual({
      text: 'The system would not post it. TinyCorp is not allowed to send notifications, so none of them arrive. Check System Settings → Notifications → TinyCorp.',
      systemSettings: true,
      tone: 'warning',
    })
  })

  it('offers no System Settings where the platform has no notifications at all', () => {
    expect(deliveryMessage({ status: 'unsupported' }, 'test')).toEqual({
      text: 'This system cannot post notifications at all, so nothing will arrive here.',
      systemSettings: false,
      tone: 'warning',
    })
  })

  it('blames the toggle, not the system, when this Company has notifications off', () => {
    expect(deliveryMessage({ status: 'off' }, 'test')).toEqual({
      text: 'Notifications are off for this Company, so none was sent. Turn them on, save, and try again.',
      systemSettings: false,
      tone: 'warning',
    })
  })

  /**
   * A Linux desktop has no one Notifications pane to open — `notificationSettingsUrl` answers null
   * there — so the link would have done nothing at all, silently. The row says the same sentence
   * and offers no button, which is the honest half (T177).
   */
  it('offers no System Settings on a Linux desktop, which has no pane to open', () => {
    const refused = { status: 'refused', reason: 'no' } as const

    expect(deliveryMessage(refused, 'test', 'darwin')?.systemSettings).toBe(true)
    expect(deliveryMessage(refused, 'test', 'win32')?.systemSettings).toBe(true)
    expect(deliveryMessage(refused, 'test', 'linux')?.systemSettings).toBe(false)
    // The refusal itself does not change; only the place the boss is sent to look does (T221).
    expect(deliveryMessage(refused, 'test', 'linux')?.text).toContain('The system would not post it')
    expect(deliveryMessage(refused, 'test', 'linux')?.text).toContain('your desktop’s own settings')
  })
})
