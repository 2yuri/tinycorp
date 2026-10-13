// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import { deskCapture } from './DeskCapture'

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

/**
 * The desk capture had no test, and it had stopped drawing.
 *
 * The panel's cards are chat's own, so it reads everything `useChatData` reads — and when the
 * daily digest was added to that hook (T172) this harness's stub was one API short. `BossDesk`
 * threw on `api.digest.onChanged`, React rendered nothing, and the capture shot the page's
 * background colour: a flat `#0B1220` that its README went on quoting as `Your desk`. A blank
 * page is also the most stable baseline there is, which is why T209 found it and this says so.
 */
describe('the desk capture harness', () => {
  it('draws the panel, not an empty window', async () => {
    mounted = await mountCapture(() => deskCapture())

    expect(mounted.text).toContain('Your desk')
    expect(mounted.text).toContain('Waiting on you')
  })
})
