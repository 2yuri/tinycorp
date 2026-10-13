// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import { teamCapture } from './TeamCapture'

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

/** The Team screen's first harness (T209): `employees.css` was drawn by no capture before it. */
describe('the team capture harness', () => {
  it('draws the roster and the side panel', async () => {
    mounted = await mountCapture(() => teamCapture())

    expect(mounted.text).toContain('Employees')
    expect(mounted.text).toContain('Nova')
    expect(mounted.text).toContain('Hire proposal')
  })
})
