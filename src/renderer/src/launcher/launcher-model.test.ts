import { describe, expect, it } from 'vitest'
import type { CompanySummary } from '../../../shared/company'
import { byRecency } from '../../../shared/company'
import {
  COMPANY_TONES,
  companyTone,
  filterSummaries,
  launcherKey,
  noMatch,
  startsSearch,
  versionLabel,
} from './launcher-model'

function summary(id: string, patch: Partial<CompanySummary> = {}): CompanySummary {
  return {
    id,
    name: id,
    key: 'AC',
    boss: { name: 'Ada', initials: 'AD' },
    folder: `/work/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    open: false,
    current: false,
    employees: 1,
    sessions: 0,
    lastOpenedAt: null,
    onboardingCompletedAt: null,
    missing: false,
    databaseElsewhere: false,
    ...patch,
  }
}

const press = (key: string, meta = false) => ({ key, metaKey: meta, ctrlKey: false })

describe('Launcher model', () => {
  it('colours a Company by its key, the same key always the same way', () => {
    expect(companyTone('TC')).toBe(companyTone('TC'))
    expect(COMPANY_TONES).toContain(companyTone('TC'))
    expect(COMPANY_TONES).toContain(companyTone(undefined))
    expect(companyTone(null)).toBe(companyTone(''))
    const tones = new Set(['TC', 'AS', 'LR', 'NV', 'AC', 'GL', 'BO', 'XYZ'].map(companyTone))
    expect(tones.size).toBeGreaterThan(1)
  })

  it('lists the current Company first, then open ones, then by last visit', () => {
    const list = [
      summary('never'),
      summary('old', { lastOpenedAt: '2026-09-01T00:00:00.000Z' }),
      summary('open', { open: true, lastOpenedAt: '2026-08-01T00:00:00.000Z' }),
      summary('recent', { lastOpenedAt: '2026-09-16T00:00:00.000Z' }),
      summary('current', { open: true, current: true }),
    ]
    expect(byRecency(list).map((s) => s.id)).toEqual(['current', 'open', 'recent', 'old', 'never'])
  })

  it('moves the highlight with the arrows and stops at the ends', () => {
    expect(launcherKey(press('ArrowDown'), 0, 3)).toEqual({ kind: 'highlight', index: 1 })
    expect(launcherKey(press('ArrowDown'), 2, 3)).toEqual({ kind: 'highlight', index: 2 })
    expect(launcherKey(press('ArrowUp'), 0, 3)).toEqual({ kind: 'highlight', index: 0 })
    expect(launcherKey(press('ArrowUp'), 2, 3)).toEqual({ kind: 'highlight', index: 1 })
    expect(launcherKey(press('End'), 0, 3)).toEqual({ kind: 'highlight', index: 2 })
    expect(launcherKey(press('a'), 0, 3)).toBeNull()
  })

  it('opens the highlighted row on Enter and the first four with ⌘1–⌘4', () => {
    expect(launcherKey(press('Enter'), 1, 3)).toEqual({ kind: 'open', index: 1 })
    expect(launcherKey(press('1', true), 2, 6)).toEqual({ kind: 'open', index: 0 })
    expect(launcherKey(press('4', true), 0, 6)).toEqual({ kind: 'open', index: 3 })
    expect(launcherKey(press('5', true), 0, 6)).toBeNull()
    expect(launcherKey(press('3', true), 0, 2)).toBeNull()
    expect(launcherKey(press('Enter'), 0, 0)).toBeNull()
  })

  it('writes the version the way the footer shows it', () => {
    expect(versionLabel('0.9.4')).toBe('v0.9.4 · beta')
    expect(versionLabel('1.2.0')).toBe('v1.2.0')
  })

  it('filters by name, key and the folder as the row writes it, whatever the case', () => {
    const list = [
      summary('acme', { name: 'Acme Works', key: 'AW', folder: '/Users/ada/code/acme' }),
      summary('lumen', { name: 'Lumen Labs', key: 'LL', folder: '/Users/ada/code/lumen' }),
      summary('globex', { name: 'Globex', key: 'GX', folder: '/srv/globex' }),
    ]
    const ids = (query: string) => filterSummaries(list, query).map((s) => s.id)
    expect(ids('')).toEqual(['acme', 'lumen', 'globex'])
    expect(ids('  ')).toEqual(['acme', 'lumen', 'globex'])
    expect(ids('LUM')).toEqual(['lumen'])
    expect(ids('gx')).toEqual(['globex'])
    expect(ids('code/ac')).toEqual(['acme'])
    expect(ids('srv')).toEqual(['globex'])
    // the home folder is written `~`, so the boss's own user name matches nothing
    expect(ids('ada')).toEqual([])
    expect(noMatch(' zq ')).toBe('No company matches “zq”.')
  })

  it('starts the search on a typed character, never on Space or a shortcut', () => {
    const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
      key: k,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...mods,
    })
    expect(startsSearch(key('a'))).toBe(true)
    expect(startsSearch(key('7'))).toBe(true)
    expect(startsSearch(key(' '))).toBe(false)
    expect(startsSearch(key('ArrowDown'))).toBe(false)
    expect(startsSearch(key('1', { metaKey: true }))).toBe(false)
    expect(startsSearch(key('k', { ctrlKey: true }))).toBe(false)
  })
})
