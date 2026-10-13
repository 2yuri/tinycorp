import { describe, expect, it } from 'vitest'
import { CHECK_EVERY_MS, compareVersions, isNewerTag, normaliseVersion, parseVersion } from './updates'

describe('reading a tag', () => {
  it('reads a release tag with or without its v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion(' v1.2.3 ')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('keeps the prerelease and drops the build metadata', () => {
    expect(parseVersion('v1.0.0-beta.2')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['beta', 2] })
    expect(parseVersion('1.0.0+2b19471')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })
  })

  it('refuses anything that is not a version', () => {
    for (const tag of ['nightly', '', 'v1', '1.2', 'v1.2.x', '1.2.3.4', 'latest', 'v-1.2.3', '1.0.0-', '1.0.0-a..b']) {
      expect(parseVersion(tag), tag).toBeNull()
    }
  })

  it('writes a version back the way the app shows it', () => {
    expect(normaliseVersion(parseVersion('v1.2.3')!)).toBe('1.2.3')
    expect(normaliseVersion(parseVersion('v1.2.3-rc.1')!)).toBe('1.2.3-rc.1')
  })
})

describe('comparing two versions', () => {
  const order = (a: string, b: string) => compareVersions(parseVersion(a)!, parseVersion(b)!)

  it('orders by major, then minor, then patch', () => {
    expect(order('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(order('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(order('1.1.2', '1.1.10')).toBeLessThan(0)
    expect(order('1.2.3', '1.2.3')).toBe(0)
  })

  it('puts a prerelease below the release it leads to', () => {
    expect(order('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(order('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(order('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    expect(order('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(order('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(order('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
  })
})

describe('is this tag worth telling the boss about', () => {
  it('says yes only to a newer tag', () => {
    expect(isNewerTag('v0.4.0', '0.3.9')).toBe(true)
    expect(isNewerTag('v0.3.9', '0.3.9')).toBe(false)
    expect(isNewerTag('v0.3.8', '0.3.9')).toBe(false)
  })

  it('ignores a malformed tag rather than trusting it', () => {
    expect(isNewerTag('nightly', '0.3.9')).toBe(false)
    expect(isNewerTag('', '0.3.9')).toBe(false)
    expect(isNewerTag('v9.9.9', 'not-a-version')).toBe(false)
  })

  it('waits six hours between requests', () => {
    expect(CHECK_EVERY_MS).toBe(6 * 60 * 60 * 1000)
  })
})
