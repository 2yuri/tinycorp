// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import * as fixture from './fixture'
import { profileCapture } from './ProfileCapture'

let mounted: MountedCapture
afterEach(() => {
  mounted?.unmount()
  vi.useRealTimers()
})

/**
 * A harness whose stub has fallen behind the shell throws on mount and shoots an empty window —
 * which the next auditor compares with the frame. Asking it whether it drew its screen is the whole
 * test; it is what nobody asked for eighteen days (T146).
 */
describe('the Your profile capture harness', () => {
  it('draws the screen, not an empty window', async () => {
    mounted = await mountCapture(profileCapture)

    // The shell around the screen, and the screen's own cards.
    expect(mounted.text).toContain(fixture.company.name)
    expect(mounted.text).toContain('Your profile')
    expect(mounted.text).toContain(fixture.boss.name)
    expect(mounted.text).toContain('Your sprite')
    expect(mounted.text).toContain('Providers')
    // `ScreenBoundary` draws this over a screen that threw. A capture of it is a full window of
    // pixels and none of them are Your profile.
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })

  it("keeps the Providers card's reset at the frame's clock time whenever it is shot", async () => {
    // A capture shot long after the fixture was written, in a zone of its own: the frame writes
    // `resets 21:00`, and a reset pinned to one instant reads a different hour on every runner
    // and has passed by now besides (T148).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-03-04T18:45:00.000Z'))
    mounted = await mountCapture(profileCapture)

    expect(mounted.text).toContain(`resets ${String(fixture.RESETS_AT_HOUR).padStart(2, '0')}:00`)
    expect(mounted.text).toContain(`${fixture.USED_PERCENT}%`)
  })
})
