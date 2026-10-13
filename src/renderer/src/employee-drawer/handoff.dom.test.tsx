// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type MountedCapture, mountCapture } from '../capture/mount'
import { copiedText, drawerCapture } from './capture/DrawerCapture'
import * as fixture from './capture/fixture'
import { COPY_HANDOFF_LABEL, HANDOFF_WHILE_LIVE, handoffBlocked } from './drawer-model'

/**
 * The drawer's handoff button (frame `zOVl6`): it copies the command that opens this Employee's
 * Session in the boss's own terminal, and it is off while the Session is live — two terminals on
 * one Session would talk over each other.
 *
 * Nothing here runs a command. The button writes to the clipboard and says so.
 */

let mounted: MountedCapture
afterEach(() => {
  mounted?.unmount()
  vi.useRealTimers()
})

const button = () => mounted.host.querySelector<HTMLButtonElement>('.employee-drawer__handoff')

describe('the handoff button', () => {
  it('is off while a Session has a process behind it, and says why', () => {
    expect(handoffBlocked('busy')).toBe(HANDOFF_WHILE_LIVE)
    expect(handoffBlocked('idle')).toBe(HANDOFF_WHILE_LIVE)
    expect(handoffBlocked('starting')).toBe(HANDOFF_WHILE_LIVE)
    // The Session is running; that the limit has been hit does not make it safe to drive twice.
    expect(handoffBlocked('out_of_budget')).toBe(HANDOFF_WHILE_LIVE)
  })

  it('is on when there is no process: stopped, or parked waiting for a seat', () => {
    expect(handoffBlocked('off')).toBeNull()
    expect(handoffBlocked('parked')).toBeNull()
  })

  it('is drawn disabled, with the frame’s sentence on it, while the Session is live', async () => {
    mounted = await mountCapture(drawerCapture)

    expect(button()?.disabled).toBe(true)
    expect(button()?.title).toBe(HANDOFF_WHILE_LIVE)
  })

  it('offers the copy once the Session is stopped', async () => {
    mounted = await mountCapture(() => drawerCapture('handoff'))

    expect(button()?.disabled).toBe(false)
    expect(button()?.title).toBe(COPY_HANDOFF_LABEL)
  })
})

describe('pressing it', () => {
  // The harness stands in for `navigator.clipboard` and records what the drawer handed it: jsdom
  // has none, and headless Chrome refuses one on an unfocused document.
  beforeEach(() => copiedText.splice(0))

  it('puts the whole command on the clipboard and reads back the short one', async () => {
    mounted = await mountCapture(() => drawerCapture('handoff'))

    await act(async () => button()!.click())

    expect(copiedText).toEqual([fixture.handoff.command])
    expect(mounted.host.querySelector('[data-ui="Toast"]')?.textContent).toBe(`Copied: ${fixture.handoff.shown}`)
  })

  it('copies and nothing else: no Session is started or stopped by it', async () => {
    mounted = await mountCapture(() => drawerCapture('handoff'))
    const before = mounted.host.textContent

    await act(async () => button()!.click())

    // The footer still offers to start the Session: the button did not run one.
    expect(before).toContain('Start Session')
    expect(mounted.host.textContent).toContain('Start Session')
  })

  it('does nothing at all while the Session is live, even if the click gets through', async () => {
    mounted = await mountCapture(drawerCapture)

    await act(async () => button()!.click())

    expect(copiedText).toEqual([])
    expect(mounted.host.querySelector('[data-ui="Toast"]')).toBeNull()
  })
})
