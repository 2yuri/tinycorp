import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptFormerUserData } from './rename-migration'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function appSupport(): { root: string; former: string; current: string } {
  const root = mkdtempSync(join(tmpdir(), 'tinycorp-rename-'))
  scratch.push(root)
  const former = join(root, 'better-office')
  mkdirSync(join(former, 'sessions'), { recursive: true })
  writeFileSync(join(former, 'recent-companies.json'), '[{"id":"c1","name":"Tiny Corp"}]')
  writeFileSync(join(former, 'sessions', 'c1.json'), '{"session":"kept"}')
  return { root, former, current: join(root, 'tinycorp') }
}

describe('Adopting the former better-office user data', () => {
  it('copies Companies and Sessions when TinyCorp starts empty', () => {
    const { current } = appSupport()
    expect(adoptFormerUserData(current)).toBe(true)
    expect(readFileSync(join(current, 'recent-companies.json'), 'utf8')).toContain('Tiny Corp')
    expect(readFileSync(join(current, 'sessions', 'c1.json'), 'utf8')).toContain('kept')
  })

  it('leaves an existing TinyCorp folder alone', () => {
    const { current } = appSupport()
    mkdirSync(current, { recursive: true })
    writeFileSync(join(current, 'recent-companies.json'), '[]')
    expect(adoptFormerUserData(current)).toBe(false)
    expect(readFileSync(join(current, 'recent-companies.json'), 'utf8')).toBe('[]')
  })

  it('does nothing when there is no former folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'tinycorp-rename-'))
    scratch.push(root)
    expect(adoptFormerUserData(join(root, 'tinycorp'))).toBe(false)
    expect(existsSync(join(root, 'tinycorp', 'recent-companies.json'))).toBe(false)
  })
})
