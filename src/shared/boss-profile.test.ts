import { describe, expect, it } from 'vitest'
import {
  BOSS_HANDLE_PATTERN,
  defaultBoss,
  durationOf,
  handleFrom,
  handleInput,
  mentionOf,
  spriteIndex,
  statusAt,
  statusUntilFrom,
} from './boss-profile'
import { CHARACTER_SHEETS } from './office/characters'

describe('the boss handle', () => {
  it('takes the first word of the name, lower case and letters only', () => {
    expect(handleFrom('Yuri Miguel')).toBe('yuri')
    expect(handleFrom('Ada Lorne-Vale')).toBe('ada')
    expect(handleFrom('  Renée  ')).toBe('rene')
  })

  it('never comes out empty', () => {
    expect(handleFrom('   ')).toBe('boss')
    expect(handleFrom('小林')).toBe('boss')
  })

  it('drops the at sign and anything a handle may not hold as it is typed', () => {
    expect(handleInput('@Yuri Miguel!')).toBe('yurimiguel')
    expect(handleInput('a.b-c_d')).toBe('a.b-c_d')
  })

  it('shows with the at sign', () => {
    expect(mentionOf('yuri')).toBe('@yuri')
    expect(BOSS_HANDLE_PATTERN.test('yuri')).toBe(true)
    expect(BOSS_HANDLE_PATTERN.test('.yuri')).toBe(false)
  })
})

describe('the boss status', () => {
  const now = Date.UTC(2026, 0, 1, 12)

  it('clears itself once its duration has passed', () => {
    expect(statusAt({ status: 'away', statusUntil: now + 60_000 }, now)).toBe('away')
    expect(statusAt({ status: 'away', statusUntil: now - 1 }, now)).toBe('available')
    expect(statusAt({ status: 'focused', statusUntil: null }, now)).toBe('focused')
  })

  it('round-trips a duration through the time it clears at', () => {
    expect(statusUntilFrom('never', now)).toBeNull()
    expect(statusUntilFrom('1h', now)).toBe(now + 3_600_000)
    expect(durationOf(statusUntilFrom('4h', now), now)).toBe('4h')
    expect(durationOf(null, now)).toBe('never')
    expect(durationOf(now - 1, now)).toBe('never')
  })
})

describe('the boss sprite', () => {
  it('stays inside the sheet', () => {
    expect(spriteIndex(0)).toBe(0)
    expect(spriteIndex(5)).toBe(5)
    expect(spriteIndex(CHARACTER_SHEETS)).toBe(0)
    expect(spriteIndex(-1)).toBe(CHARACTER_SHEETS - 1)
  })
})

describe('a fresh profile', () => {
  it('is the OS account name, its handle, its initials and the first character', () => {
    expect(defaultBoss('Yuri Miguel', 'yuri@example.com')).toEqual({
      name: 'Yuri Miguel',
      handle: 'yuri',
      initials: 'YM',
      email: 'yuri@example.com',
      sprite: 0,
      status: 'available',
      statusUntil: null,
      sound: false,
      providerRuntimes: {},
      // Nothing about this desk is answered until the boss answers it (T249).
      defaultRuntime: null,
      rightClick: null,
      windowsSetupDone: false,
    })
  })

  it('falls back to Boss for a blank name', () => {
    expect(defaultBoss('  ')).toMatchObject({ name: 'Boss', handle: 'boss', initials: 'BO' })
  })
})
