import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import {
  hasChanges,
  keyInput,
  parseCap,
  type SavedSettings,
  sampleTicketId,
  settingsChanges,
  settingsDraft,
  settingsProblems,
} from './settings-model'

const acme: Company = {
  id: 'c1',
  name: 'Acme Labs',
  key: 'AL',
  boss: { name: 'Grace Holt', initials: 'GH' },
  folder: '/work/acme',
  createdAt: '',
}
const saved: SavedSettings = {
  company: acme,
  concurrencyCap: 3,
  autonomy: 'managed',
  notifications: true,
  room: 'night-studio',
  permissionMode: 'skip-permissions',
}

describe('Company settings form', () => {
  it('starts from the saved settings with nothing to save', () => {
    const draft = settingsDraft(saved)

    expect(draft).toEqual({
      name: 'Acme Labs',
      key: 'AL',
      concurrencyCap: '3',
      autonomy: 'managed',
      notifications: true,
      room: 'night-studio',
      permissionMode: 'skip-permissions',
    })
    expect(settingsChanges(saved, draft)).toEqual({ company: {} })
    expect(hasChanges(saved, draft)).toBe(false)
    expect(settingsProblems(draft)).toEqual({})
  })

  it('sends only what changed, trimmed, to the API that takes it', () => {
    const draft = {
      ...settingsDraft(saved),
      name: ' Acme ',
      concurrencyCap: '5',
      autonomy: 'autonomous' as const,
      notifications: false,
    }

    expect(settingsChanges(saved, draft)).toEqual({
      company: { name: 'Acme' },
      concurrencyCap: 5,
      autonomy: 'autonomous',
      notifications: false,
    })
    expect(hasChanges(saved, draft)).toBe(true)
  })

  it('sends the permission default only when the boss moved it (T164)', () => {
    const draft = { ...settingsDraft(saved), permissionMode: 'interactive' as const }

    expect(settingsChanges(saved, draft)).toEqual({ company: {}, permissionMode: 'interactive' })
    expect(hasChanges(saved, draft)).toBe(true)
    expect(hasChanges(saved, settingsDraft(saved))).toBe(false)
  })

  it('counts a cap that cannot be saved as a change, but never sends it', () => {
    const draft = { ...settingsDraft(saved), concurrencyCap: '0' }

    expect(settingsChanges(saved, draft)).toEqual({ company: {} })
    expect(hasChanges(saved, draft)).toBe(true)
    expect(settingsProblems(draft)).toEqual({ concurrencyCap: expect.stringMatching(/at least 1/) })
  })

  it('leaves the boss out: their name and character live in Your profile (T79)', () => {
    const draft = settingsDraft(saved)
    expect(Object.keys(draft)).not.toContain('bossName')
    expect(Object.keys(draft)).not.toContain('bossInitials')
    expect(settingsChanges(saved, { ...draft, name: 'Tiny Corp 2' }).company).toEqual({ name: 'Tiny Corp 2' })
  })

  it('names what is wrong per field', () => {
    const draft = { ...settingsDraft(saved), bossName: ' ', bossInitials: 'ABCD', name: '', key: 'A' }

    expect(settingsProblems(draft)).toEqual({
      name: expect.stringMatching(/name/),
      key: expect.stringMatching(/2 to 4 uppercase/),
    })
  })

  it('keeps a typed key to four uppercase letters and shows the ticket id it gives', () => {
    expect(keyInput('ac-me9x')).toBe('ACME')
    expect(sampleTicketId('TC')).toBe('TC-142')
    expect(sampleTicketId('')).toBe('KEY-142')
  })

  it('accepts only whole caps of at least 1', () => {
    expect(parseCap('4')).toEqual({ cap: 4 })
    for (const bad of ['', '0', '-1', '2.5', 'x']) expect(parseCap(bad)).toHaveProperty('error')
  })
})
