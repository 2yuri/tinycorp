import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultBoss } from '../../shared/boss-profile'
import { createBossProfiles } from '../features/company/boss-profile'
import { bossProfileFile } from './boss-profile-file'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-boss-'))
  dirs.push(dir)
  return join(dir, 'nested', 'boss-profile.json')
}

describe('the boss profile file', () => {
  it('has nothing to read before anything is written', () => {
    expect(bossProfileFile(tempFile()).read()).toBeNull()
  })

  it('keeps the profile across instances, folders and all', () => {
    const file = tempFile()
    bossProfileFile(file).write({ ...defaultBoss('Yuri Miguel'), sprite: 4, status: 'focused' })

    expect(bossProfileFile(file).read()).toMatchObject({ name: 'Yuri Miguel', sprite: 4, status: 'focused' })
  })

  it('ignores a file that is not a profile', () => {
    const file = tempFile()
    bossProfileFile(file).write(defaultBoss('Yuri Miguel'))
    writeFileSync(file, '[1,2,3]')

    expect(bossProfileFile(file).read()).toBeNull()
  })

  /**
   * The first launch's Windows answers live here and nowhere else (T249): this file is in
   * `userData`, beside `recent-companies.json`, and not in any Company folder — so the answers
   * survive a Company being closed, deleted or moved to another machine, and a Company carried to
   * another desk carries none of them with it.
   */
  it('keeps the Windows first-launch answers, which no Company database holds', () => {
    const file = tempFile()
    const profiles = createBossProfiles({ store: bossProfileFile(file), defaultName: () => 'Yuri Miguel' })
    profiles.update({ defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu', windowsSetupDone: true })

    const written: unknown = JSON.parse(readFileSync(file, 'utf8'))
    expect(written).toMatchObject({ defaultRuntime: 'wsl:Ubuntu', rightClick: 'menu', windowsSetupDone: true })
    expect(file).toContain('boss-profile.json')
  })

  it('carries a profile a previous run stored into a fresh engine store', () => {
    const file = tempFile()
    createBossProfiles({ store: bossProfileFile(file), defaultName: () => 'Yuri Miguel' }).update({ sprite: 2 })

    expect(createBossProfiles({ store: bossProfileFile(file) }).get()).toMatchObject({
      name: 'Yuri Miguel',
      sprite: 2,
    })
  })
})
