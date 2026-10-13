// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import { onboardingReposCapture } from './OnboardingReposCapture'

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

/**
 * This one had no test and no stub of its own, so it went blank without a word the first time the
 * step reached the repositories screen through a front door (T202): `Repositories.tsx` takes
 * `window.tinyCorp.repos` at import time, and the harness had not put a preload there. The pages
 * install an empty bridge before any module now, the way the app's preload does; this is what says
 * so out loud.
 */
describe('the onboarding Repositories capture harness', () => {
  it('draws the step, not an empty window', async () => {
    mounted = await mountCapture(async () => onboardingReposCapture())

    expect(mounted.text).toContain('Repositories')
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })

  /** The two steps T209 added so that `team-step.css` and `first-ticket-step.css` are drawn at all. */
  it('draws the team step', async () => {
    mounted = await mountCapture(async () => onboardingReposCapture('team'))

    expect(mounted.text).toContain('Your starting team')
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })

  it('draws the first ticket step', async () => {
    mounted = await mountCapture(async () => onboardingReposCapture('first-ticket'))

    expect(mounted.text).toContain('Nova plans it')
    expect(mounted.text).not.toContain('This screen stopped drawing')
  })
})
