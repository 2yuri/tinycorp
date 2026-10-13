// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import { backNowLabel, routingChipLabel } from '../../routing/RoutingChip'
import { drawerCapture } from './DrawerCapture'
import * as fixture from './fixture'

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

/**
 * This harness rendered nothing from the day it was written: `useInbox` started reading the
 * Company two and a half minutes after the harness landed, and the stub never grew a `company`
 * member. Nothing said so for eighteen days, because a drawer that throws looks like a drawer that
 * is simply dark (T146).
 */
describe('the Employee drawer capture harness', () => {
  it('draws the drawer on its Chats tab, not bare background', async () => {
    mounted = await mountCapture(drawerCapture)

    // The head, the tab the harness opens on, and the conversations the frame shows.
    expect(mounted.text).toContain(fixture.nova.name)
    expect(mounted.text).toContain('Conversations')
    expect(mounted.text).toContain(fixture.vega.name)
    expect(mounted.text).toContain('Stop Session')
  })
})

describe('the Employee drawer capture harness, on its subagent strip', () => {
  it('draws the Terminal tab with the frame’s strip: Nova first, then its subagents', async () => {
    mounted = await mountCapture(() => drawerCapture('subagents'))

    const chips = [...mounted.host.querySelectorAll('.subagent-chip')].map((chip) => chip.textContent)
    expect(chips).toEqual(['Nova', 'tests', 'migration', 'docs'])
    expect(mounted.text).toContain('Stop Session')
  })
})

describe('the Employee drawer capture harness, on its routing chip', () => {
  it('says where the Employee is working and how to bring it back (T173)', async () => {
    mounted = await mountCapture(() => drawerCapture('routed'))
    const routed = fixture.routedTo()

    expect(mounted.text).toContain(routingChipLabel(routed, new Date()))
    expect(mounted.text).toContain(backNowLabel(routed))
  })
})
