import { describe, expect, it } from 'vitest'
import { defaultBoss } from '../../../shared/boss-profile'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { inMemoryBossProfile } from '../../core/testing'
import { applyBossUpdate, createBossProfiles, normaliseBoss } from './boss-profile'

describe('the boss profile store', () => {
  it('starts from the OS account name and writes it once', () => {
    const store = inMemoryBossProfile()
    const profiles = createBossProfiles({ store, defaultName: () => 'Yuri Miguel' })

    expect(profiles.get()).toMatchObject({ name: 'Yuri Miguel', handle: 'yuri', initials: 'YM', sprite: 0 })
    expect(store.read()).toMatchObject({ name: 'Yuri Miguel' })
  })

  it('reads back what was written', () => {
    const store = inMemoryBossProfile()
    const until = Date.now() + 3_600_000
    const profiles = createBossProfiles({ store, defaultName: () => 'Yuri Miguel' })

    profiles.update({ handle: 'boss', sprite: 3, status: 'focused', statusUntil: until, sound: true })

    expect(profiles.get()).toMatchObject({
      handle: 'boss',
      sprite: 3,
      status: 'focused',
      statusUntil: until,
      sound: true,
    })
    expect(createBossProfiles({ store }).get()).toMatchObject({ handle: 'boss', sprite: 3, status: 'focused' })
  })

  it('tells listeners after every change', () => {
    const profiles = createBossProfiles({ store: inMemoryBossProfile() })
    let changes = 0
    const off = profiles.onChanged(() => changes++)

    profiles.update({ name: 'Ada' })
    expect(changes).toBe(1)
    off()
    profiles.update({ name: 'Grace' })
    expect(changes).toBe(1)
  })

  it('clears a status whose duration has run out, and keeps one that has not', () => {
    const clock = { at: 1_000 }
    const profiles = createBossProfiles({ store: inMemoryBossProfile(), now: () => clock.at })
    profiles.update({ status: 'away', statusUntil: 2_000 })

    expect(profiles.get()).toMatchObject({ status: 'away', statusUntil: 2_000 })
    clock.at = 2_001
    expect(profiles.get()).toMatchObject({ status: 'available', statusUntil: null })
  })

  it('migrates the boss fields Companies carried, once', () => {
    const store = inMemoryBossProfile()
    const profiles = createBossProfiles({
      store,
      defaultName: () => 'someone-else',
      storedCompanies: () => [{ name: 'Yuri Miguel', initials: 'YM' }],
    })

    expect(profiles.get()).toMatchObject({ name: 'Yuri Miguel', initials: 'YM', handle: 'yuri' })
  })

  it('never lets an old Company field overwrite a profile the boss has set', () => {
    const store = inMemoryBossProfile()
    const profiles = createBossProfiles({ store, defaultName: () => 'Yuri Miguel' })
    profiles.update({ name: 'Ada Lorne' })

    profiles.adopt({ name: 'Stale Name', initials: 'SN' })

    expect(profiles.get().name).toBe('Ada Lorne')
  })

  it('adopts a Company row only the first time', () => {
    const profiles = createBossProfiles({ store: inMemoryBossProfile(), defaultName: () => 'Boss' })

    profiles.adopt({ name: 'Yuri Miguel', initials: 'YM' })
    profiles.adopt({ name: 'Someone Else', initials: 'SE' })

    expect(profiles.get()).toMatchObject({ name: 'Yuri Miguel', initials: 'YM' })
  })
})

describe('an update to the profile', () => {
  const boss = defaultBoss('Yuri Miguel')

  it('refuses a blank name, a bad handle, odd initials and a sprite off the sheet', () => {
    expect(() => applyBossUpdate(boss, { name: '  ' })).toThrow(/needs a name/)
    expect(() => applyBossUpdate(boss, { handle: 'Yuri Miguel' })).toThrow(/handle is/)
    expect(() => applyBossUpdate(boss, { initials: 'TOOLONG' })).toThrow(/Initials/)
    expect(() => applyBossUpdate(boss, { sprite: CHARACTER_SHEETS })).toThrow(/one of the \d+ characters/)
    expect(() => applyBossUpdate(boss, { sprite: 1.5 })).toThrow(/one of the \d+ characters/)
  })

  it('takes a handle with the at sign the boss typed', () => {
    expect(applyBossUpdate(boss, { handle: '@Ada' }).handle).toBe('ada')
  })

  it('follows the name with initials that were never set by hand', () => {
    expect(applyBossUpdate(boss, { name: 'Ada Lorne' }).initials).toBe('AL')
    const pinned = applyBossUpdate(boss, { initials: 'Y' })
    expect(applyBossUpdate(pinned, { name: 'Ada Lorne' }).initials).toBe('Y')
  })

  it('follows the name with a handle that was never set by hand', () => {
    expect(applyBossUpdate(boss, { name: 'Ada Lorne' }).handle).toBe('ada')
    const pinned = applyBossUpdate(boss, { handle: 'chief' })
    expect(applyBossUpdate(pinned, { name: 'Ada Lorne' }).handle).toBe('chief')
  })

  it('goes back to the name when the initials are cleared', () => {
    expect(applyBossUpdate(boss, { initials: '' }).initials).toBe('YM')
  })
})

describe('a stored profile', () => {
  it('fills in what an older or hand-edited file left out', () => {
    expect(normaliseBoss({ name: 'Ada Lorne' }, 'Boss')).toEqual({
      name: 'Ada Lorne',
      handle: 'ada',
      initials: 'AL',
      email: '',
      sprite: 0,
      status: 'available',
      statusUntil: null,
      sound: false,
      providerRuntimes: {},
      defaultRuntime: null,
      rightClick: null,
      windowsSetupDone: false,
    })
  })

  it('drops a status and a sprite it cannot make sense of', () => {
    const odd = normaliseBoss({ name: 'Ada', status: 'busy' as never, sprite: 'two' as never }, 'Boss')
    expect(odd).toMatchObject({ status: 'available', sprite: 0 })
  })
})

/**
 * Where each Provider runs, kept beside the rest of the profile (T167): one machine, one answer,
 * every Company on it the same.
 */
describe('the place a Provider runs in', () => {
  it('starts empty: nothing is picked until the boss picks it', () => {
    expect(normaliseBoss({ name: 'Ada' }, 'Boss').providerRuntimes).toEqual({})
  })

  it('keeps what was picked, and merges a new pick into it', () => {
    const current = { ...normaliseBoss({ name: 'Ada' }, 'Boss'), providerRuntimes: { claude: 'wsl:Ubuntu' } }
    expect(applyBossUpdate(current, { providerRuntimes: { codex: 'windows' } }).providerRuntimes).toEqual({
      claude: 'wsl:Ubuntu',
      codex: 'windows',
    })
  })

  it('refuses a place that is not one, rather than store a Session that cannot start', () => {
    const current = normaliseBoss({ name: 'Ada' }, 'Boss')
    expect(() => applyBossUpdate(current, { providerRuntimes: { claude: 'wsl:' } })).toThrow(/not a place/)
    expect(() => applyBossUpdate(current, { providerRuntimes: { claude: 'somewhere' } })).toThrow(/not a place/)
  })

  it('drops the entries a hand-edited file left meaningless, and keeps the rest', () => {
    const stored = { name: 'Ada', providerRuntimes: { claude: 'wsl:Ubuntu', codex: 42, opencode: '' } }
    expect(normaliseBoss(stored as never, 'Boss').providerRuntimes).toEqual({ claude: 'wsl:Ubuntu' })
  })
})

/**
 * The three answers the first launch on Windows asks for (T249). They are in the boss's profile
 * and in no Company database: which machine the team runs on, and what a mouse button does on it,
 * are facts about this desk — the four Companies open here get the same answer, and a Company
 * carried to another machine carries none of it with it.
 */
describe('the Windows first-launch settings', () => {
  const fresh = () => normaliseBoss({ name: 'Ada' }, 'Boss')

  it('start unanswered, which reads as this platform’s own habit', () => {
    expect(fresh()).toMatchObject({ defaultRuntime: null, rightClick: null, windowsSetupDone: false })
  })

  it('are written to the profile store and read back from it', () => {
    const store = inMemoryBossProfile()
    const profiles = createBossProfiles({ store, defaultName: () => 'Ada' })

    profiles.update({ defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu', windowsSetupDone: true })

    expect(store.read()).toMatchObject({ defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu', windowsSetupDone: true })
    // And a fresh engine over the same file answers the same, which is what "shown once" rests on.
    expect(createBossProfiles({ store }).get()).toMatchObject({
      defaultRuntime: 'wsl:Ubuntu',
      rightClick: 'menu',
      windowsSetupDone: true,
    })
  })

  it('go back to the platform’s habit when the boss clears them', () => {
    const current = { ...fresh(), defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu' as const }
    expect(applyBossUpdate(current, { defaultRuntime: null, rightClick: null })).toMatchObject({
      defaultRuntime: null,
      rightClick: null,
    })
  })

  it('refuse a place that is not one, and a right-click that does nothing', () => {
    expect(() => applyBossUpdate(fresh(), { defaultRuntime: 'wsl:' })).toThrow(/not a place/)
    expect(() => applyBossUpdate(fresh(), { rightClick: 'shrug' as never })).toThrow(/right-click/)
  })

  it('drop what a hand-edited file left meaningless rather than lose the whole profile', () => {
    const stored = { name: 'Ada', defaultRuntime: 'somewhere', rightClick: 'shrug', windowsSetupDone: 'yes' }
    expect(normaliseBoss(stored as never, 'Boss')).toMatchObject({
      defaultRuntime: null,
      rightClick: null,
      windowsSetupDone: false,
    })
  })

  it('leave everything else alone: one card saved does not reset another', () => {
    const current = { ...fresh(), defaultRuntime: 'windows', rightClick: 'paste' as const, windowsSetupDone: true }
    expect(applyBossUpdate(current, { name: 'Grace' })).toMatchObject({
      defaultRuntime: 'windows',
      rightClick: 'paste',
      windowsSetupDone: true,
    })
  })
})
