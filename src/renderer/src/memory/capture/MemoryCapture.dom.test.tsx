// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import * as fixture from './fixture'
import { memoryCapture } from './MemoryCapture'

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

/**
 * A harness that throws on mount shoots an empty window, which the next auditor compares with the
 * frame and reads as drift. T202 put a front door on every renderer folder, and the Memory screen
 * reaches the Files viewer through one — so this harness now imports far more of the app than it
 * draws, and every one of those modules binds its corner of the preload the moment it loads.
 * Asking the harness whether it drew its screen is the whole test.
 */
describe('the Memory capture harness', () => {
  it('draws the screen, not an empty window', async () => {
    mounted = await mountCapture(memoryCapture)

    expect(mounted.text).toContain(fixture.company.name)
    expect(mounted.text).toContain('Memory')
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })
})
