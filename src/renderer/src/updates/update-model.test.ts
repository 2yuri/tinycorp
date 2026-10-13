import { describe, expect, it } from 'vitest'
import type { UpdateState } from '../../../shared/app/updates'
import { availableLine, currentBuildLine, releaseDate, updateNotice, updateStatus } from './update-model'

const quiet: UpdateState = { current: '0.3.9', available: null, checkedAt: '2026-09-18T12:00:00Z', checking: false }
const newer: UpdateState = {
  ...quiet,
  available: {
    tag: 'v0.4.0',
    version: '0.4.0',
    publishedAt: '2026-09-18T12:00:00Z',
    url: 'https://github.com/2yuri/tinycorp/releases/tag/v0.4.0',
  },
}

describe('what the update check says', () => {
  it('says nothing in the title bar unless there is a newer build', () => {
    expect(updateNotice(quiet)).toBeNull()
    expect(updateNotice({ ...quiet, checkedAt: null })).toBeNull()
    expect(updateNotice(newer)).toBe('Version 0.4.0 available')
  })

  it('names the build the boss is running, so nobody needs a terminal', () => {
    expect(currentBuildLine(quiet)).toBe('TinyCorp 0.3.9')
    // The one frame before the main process answers: the name, not a dangling space.
    expect(currentBuildLine({ ...quiet, current: '' })).toBe('TinyCorp')
  })

  it('writes the release date, and leaves it out when the release has none', () => {
    expect(releaseDate('2026-09-18T12:00:00Z')).toBe('Sep 18, 2026')
    expect(releaseDate(null)).toBe('')
    expect(releaseDate('not a date')).toBe('')
    expect(availableLine(newer)).toBe('Version 0.4.0 · Sep 18, 2026')
    expect(availableLine({ ...newer, available: { ...newer.available!, publishedAt: null } })).toBe('Version 0.4.0')
    expect(availableLine(quiet)).toBeNull()
  })

  it('never reads like an error: a check that found nothing says so plainly', () => {
    expect(updateStatus(quiet)).toBe('This is the newest build the app could find.')
    expect(updateStatus({ ...quiet, checkedAt: null })).toBe('The build you are running.')
    expect(updateStatus({ ...quiet, checking: true })).toBe('Checking for a newer build…')
    expect(updateStatus(newer)).toBe('A newer build is on GitHub.')
  })
})
