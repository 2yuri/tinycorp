import { describe, expect, it } from 'vitest'
import { defaultBoss } from '../../../shared/boss-profile'
import {
  accountLine,
  companyMeta,
  handleNote,
  hasProfileChanges,
  NO_ACCOUNT,
  previewHandle,
  profileChanges,
  profileDraft,
  profileProblems,
  runningSince,
  type SavedProfile,
} from './profile-model'

const NOW = Date.UTC(2026, 8, 18, 12)
const saved: SavedProfile = { boss: defaultBoss('Yuri Miguel', 'yuri@example.com'), notifications: true }

describe('the profile draft', () => {
  it('starts from the saved profile and the Company toggle', () => {
    expect(profileDraft(saved, NOW)).toEqual({
      name: 'Yuri Miguel',
      handle: 'yuri',
      sprite: 0,
      status: 'available',
      duration: 'never',
      notifications: true,
      sound: false,
    })
  })

  it('has nothing to save until something is typed', () => {
    const draft = profileDraft(saved, NOW)
    expect(hasProfileChanges(saved, draft, NOW)).toBe(false)
    expect(profileChanges(saved, draft, NOW)).toEqual({ profile: {} })
  })

  it('sends only what changed, trimmed', () => {
    const draft = { ...profileDraft(saved, NOW), name: '  Ada Lorne  ', sprite: 3 }

    expect(profileChanges(saved, draft, NOW)).toEqual({ profile: { name: 'Ada Lorne', sprite: 3 } })
    expect(hasProfileChanges(saved, draft, NOW)).toBe(true)
  })

  it('writes the status and how long it lasts together', () => {
    const draft = { ...profileDraft(saved, NOW), status: 'focused' as const, duration: '1h' as const }

    expect(profileChanges(saved, draft, NOW)).toEqual({
      profile: { status: 'focused', statusUntil: NOW + 3_600_000 },
    })
  })

  it('clears the expiry when the duration goes back to never', () => {
    const away: SavedProfile = { ...saved, boss: { ...saved.boss, status: 'away', statusUntil: NOW + 3_600_000 } }
    const draft = { ...profileDraft(away, NOW), duration: 'never' as const }

    expect(profileChanges(away, draft, NOW)).toEqual({ profile: { status: 'away', statusUntil: null } })
  })

  it('sends the Company notification toggle apart from the profile', () => {
    const draft = { ...profileDraft(saved, NOW), notifications: false, sound: true }

    expect(profileChanges(saved, draft, NOW)).toEqual({ profile: { sound: true }, notifications: false })
  })
})

describe('what the page refuses to save', () => {
  it('names a blank name and a handle that is not one', () => {
    const draft = { ...profileDraft(saved, NOW), name: ' ', handle: 'Not A Handle' }

    expect(profileProblems(draft)).toEqual({
      name: expect.stringMatching(/name/),
      handle: expect.stringMatching(/letters/),
    })
  })

  it('is happy with the saved profile', () => {
    expect(profileProblems(profileDraft(saved, NOW))).toEqual({})
  })
})

describe('what the page says', () => {
  it('shows the handle the name gives while none is typed', () => {
    expect(previewHandle({ name: 'Ada Lorne', handle: '' })).toBe('ada')
    expect(previewHandle({ name: 'Ada Lorne', handle: 'chief' })).toBe('chief')
  })

  it('spells out what a handle does', () => {
    expect(handleNote('yuri')).toBe(
      'Employees address you by your handle — @yuri in any channel wakes nobody but reaches your desk.',
    )
  })

  it('says since when the Company has been running', () => {
    expect(runningSince({ name: 'Tiny Corp', createdAt: '2026-03-04T10:00:00.000Z' }, NOW)).toBe(
      'Running Tiny Corp since March',
    )
    expect(runningSince({ name: 'Tiny Corp', createdAt: '2019-03-04T10:00:00.000Z' }, NOW)).toBe(
      'Running Tiny Corp since March 2019',
    )
    expect(runningSince({ name: 'Tiny Corp', createdAt: 'nonsense' }, NOW)).toBe('Running Tiny Corp')
  })

  it('counts a Company’s Employees under its name', () => {
    expect(companyMeta({ employees: 8 })).toBe('Owner · 8 Employees')
    expect(companyMeta({ employees: 1 })).toBe('Owner · 1 Employee')
    expect(companyMeta({ employees: null })).toBe('Owner')
  })

  it('names the account, or says who owns the login', () => {
    expect(accountLine('yuri@example.com')).toBe('yuri@example.com')
    expect(accountLine('  ')).toBe(NO_ACCOUNT)
  })
})
