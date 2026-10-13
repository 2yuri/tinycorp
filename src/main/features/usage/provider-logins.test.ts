import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { onDisk, removeFolder } from '../../core/testing'
import {
  CLAUDE_KEYCHAIN_ITEM,
  claudeKeychainItem,
  claudeLogin,
  claudeLoginPlaces,
  codexLogin,
  codexLoginPlaces,
} from './provider-logins'

/**
 * Where each Provider's login is read from (T257).
 *
 * The bug this is about: the meter read the macOS keychain on every platform, so a boss on Windows
 * whose Employees were working saw nothing at all. Every case below is a real home on disk — a
 * fixture that asserted against a path string would have passed before the fix too.
 */

const HOMES: string[] = []

function home(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-login-'))
  HOMES.push(folder)
  return folder
}

afterAll(() => {
  for (const folder of HOMES) removeFolder(folder)
})

/** A `.credentials.json` as Claude Code writes it, in `<config folder>`. */
function writeClaudeLogin(configDir: string, token: string): string {
  mkdirSync(configDir, { recursive: true })
  const path = join(configDir, '.credentials.json')
  writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 1_800_000_000_000 } }))
  return path
}

/** An `auth.json` as `codex login` writes it. */
function writeCodexLogin(codexHome: string, token: string): string {
  mkdirSync(codexHome, { recursive: true })
  const path = join(codexHome, 'auth.json')
  writeFileSync(path, JSON.stringify({ OPENAI_API_KEY: 'sk-secret', tokens: { access_token: token } }))
  return path
}

describe('where Claude Code keeps the login', () => {
  it('reads the macOS keychain on a Mac, as it always has', async () => {
    const asked: string[] = []
    const read = claudeLogin({
      platform: 'darwin',
      env: {},
      readKeychain: async (item) => {
        asked.push(item)
        return JSON.stringify({ claudeAiOauth: { accessToken: 'from-the-keychain', expiresAt: null } })
      },
      readText: () => Promise.reject(new Error('a Mac reads no file')),
    })

    expect(await read()).toEqual({
      login: { accessToken: 'from-the-keychain', expiresAt: null },
      lookedIn: [`the login keychain (${CLAUDE_KEYCHAIN_ITEM})`],
    })
    expect(asked).toEqual([CLAUDE_KEYCHAIN_ITEM])
  })

  it('reads the config folder’s own file on Windows and on Linux', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const boss = home()
      writeClaudeLogin(join(boss, '.claude'), `${platform}-token`)

      const read = claudeLogin({ platform, env: {}, home: () => boss })

      expect(await read()).toMatchObject({ login: { accessToken: `${platform}-token` } })
    }
  })

  it('follows CLAUDE_CONFIG_DIR where the boss set one', async () => {
    const boss = home()
    const named = join(boss, 'config', 'claude')
    writeClaudeLogin(named, 'from-the-named-folder')
    writeClaudeLogin(join(boss, '.claude'), 'from-the-default-folder')

    const read = claudeLogin({ platform: 'linux', env: { CLAUDE_CONFIG_DIR: named }, home: () => boss })

    expect(await read()).toMatchObject({ login: { accessToken: 'from-the-named-folder' } })
  })

  it('reads the distro’s own home for a Provider whose Sessions run in WSL', async () => {
    const distro = home()
    const inside = join(distro, 'home', 'b')
    writeClaudeLogin(join(inside, '.claude'), 'signed-in-inside-ubuntu')
    // The Windows side has its own login, and it is not the one a Session in Ubuntu spends.
    const windows = home()
    writeClaudeLogin(join(windows, '.claude'), 'signed-in-on-windows')

    const inUbuntu = claudeLogin({
      platform: 'win32',
      env: {},
      home: () => windows,
      runtime: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
      homesIn: () => [inside],
    })
    const onWindows = claudeLogin({
      platform: 'win32',
      env: {},
      home: () => windows,
      runtime: () => ({ kind: 'windows' }),
    })

    expect(await inUbuntu()).toMatchObject({ login: { accessToken: 'signed-in-inside-ubuntu' } })
    expect(await onWindows()).toMatchObject({ login: { accessToken: 'signed-in-on-windows' } })
  })

  it('reads an added account from its own config folder, on this side even when the Provider is in WSL', async () => {
    const boss = home()
    const added = join(boss, 'accounts', 'claude', 'work')
    writeClaudeLogin(added, 'the-work-sign-in')

    const read = claudeLogin({
      platform: 'win32',
      env: {},
      home: () => boss,
      runtime: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
      homesIn: () => [join(boss, 'distro-home')],
    })

    expect(await read({ id: 'work', configDir: added })).toMatchObject({ login: { accessToken: 'the-work-sign-in' } })
  })

  it('names the keychain item Claude Code writes for a second config folder on a Mac', async () => {
    // The CLI's own rule: the default folder's item, and any other folder's the same name with the
    // first eight hex digits of the SHA-256 of the folder behind it.
    expect(claudeKeychainItem(null)).toBe(CLAUDE_KEYCHAIN_ITEM)
    expect(claudeKeychainItem('/Users/b/.claude')).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/)
    expect(claudeKeychainItem('/Users/b/work')).not.toBe(claudeKeychainItem('/Users/b/personal'))

    const asked: string[] = []
    const read = claudeLogin({
      platform: 'darwin',
      env: {},
      readKeychain: async (item) => {
        asked.push(item)
        throw new Error('The specified item could not be found in the keychain.')
      },
    })
    await read({ id: 'work', configDir: onDisk('/Users/b/work') })

    expect(asked).toEqual([claudeKeychainItem(onDisk('/Users/b/work'))])
  })

  it('says it found nothing, and where it looked, when the file is not there', async () => {
    const boss = home()

    const read = claudeLogin({ platform: 'win32', env: {}, home: () => boss })

    expect(await read()).toEqual({ login: null, lookedIn: [join(boss, '.claude', '.credentials.json')] })
  })

  it('never reads an API key stored beside the login', async () => {
    const boss = home()
    mkdirSync(join(boss, '.claude'), { recursive: true })
    writeFileSync(join(boss, '.claude', '.credentials.json'), JSON.stringify({ apiKey: 'sk-ant-api03-secret' }))

    expect(await claudeLogin({ platform: 'linux', env: {}, home: () => boss })()).toMatchObject({ login: null })
  })
})

describe('where Codex keeps the login', () => {
  it('reads `auth.json` under the home, and under CODEX_HOME where one is named', async () => {
    const boss = home()
    writeCodexLogin(join(boss, '.codex'), 'the-default-sign-in')
    const named = join(boss, 'codex-home')
    writeCodexLogin(named, 'the-named-sign-in')

    expect(await codexLogin({ platform: 'linux', env: {}, home: () => boss })()).toMatchObject({
      login: { accessToken: 'the-default-sign-in' },
    })
    expect(await codexLogin({ platform: 'linux', env: { CODEX_HOME: named }, home: () => boss })()).toMatchObject({
      login: { accessToken: 'the-named-sign-in' },
    })
  })

  it('reads the distro’s home for a Provider whose Sessions run in WSL', async () => {
    const distro = home()
    const inside = join(distro, 'home', 'b')
    writeCodexLogin(join(inside, '.codex'), 'signed-in-inside-arch')

    const read = codexLogin({
      platform: 'win32',
      env: {},
      home: () => home(),
      runtime: () => ({ kind: 'wsl', distro: 'Arch' }),
      homesIn: () => [inside],
    })

    expect(await read()).toMatchObject({ login: { accessToken: 'signed-in-inside-arch' } })
  })

  it('says where it looked when there is no login', async () => {
    const boss = home()

    expect(await codexLogin({ platform: 'darwin', env: {}, home: () => boss })()).toEqual({
      login: null,
      lookedIn: [join(boss, '.codex', 'auth.json')],
    })
  })
})

describe('the places themselves', () => {
  it('looks in every home of a distro, because which one is the boss’s cannot be asked from here', () => {
    const places = claudeLoginPlaces(null, {
      platform: 'win32',
      env: {},
      runtime: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
      homesIn: () => ['\\\\wsl.localhost\\Ubuntu\\home\\b', '\\\\wsl.localhost\\Ubuntu\\home\\c'],
    })

    expect(places.map((place) => place.kind)).toEqual(['file', 'file'])
    expect(places).toHaveLength(2)
  })

  it('tries the boss’s own home in the distro first, the way T256 picks a Company folder', () => {
    const places = claudeLoginPlaces(null, {
      platform: 'win32',
      env: {},
      account: 'b',
      runtime: () => ({ kind: 'wsl', distro: 'Arch' }),
      homesIn: () => ['\\\\wsl.localhost\\Arch\\home\\ci', '\\\\wsl.localhost\\Arch\\home\\b'],
    })

    expect(places.map((place) => place.kind === 'file' && place.path)).toEqual([
      join('\\\\wsl.localhost\\Arch\\home\\b', '.claude', '.credentials.json'),
      join('\\\\wsl.localhost\\Arch\\home\\ci', '.claude', '.credentials.json'),
    ])
  })

  it('reads the same places whatever drive or share the Company folder is on (T256)', () => {
    // A Company folder in a distro moves no login: the boss's own is in their home, and an account
    // TinyCorp made is under the app's own data folder on this PC.
    const where = { platform: 'win32', env: {}, account: 'b', home: () => 'C:\\Users\\b' } as const
    const onWindows = claudeLoginPlaces(null, { ...where, runtime: () => ({ kind: 'windows' }) })
    const added = { id: 'work', configDir: 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\accounts\\claude\\work' }

    expect(onWindows).toEqual([{ kind: 'file', path: join('C:\\Users\\b', '.claude', '.credentials.json') }])
    expect(claudeLoginPlaces(added, { ...where, runtime: () => ({ kind: 'wsl', distro: 'Arch' }) })).toEqual([
      { kind: 'file', path: join(added.configDir, '.credentials.json') },
    ])
  })

  it('ignores this Windows process’s own CLAUDE_CONFIG_DIR inside a distro', () => {
    const places = claudeLoginPlaces(null, {
      platform: 'win32',
      env: { CLAUDE_CONFIG_DIR: 'C:\\Users\\b\\claude-config' },
      account: 'b',
      runtime: () => ({ kind: 'wsl', distro: 'Ubuntu' }),
      homesIn: () => ['\\\\wsl.localhost\\Ubuntu\\home\\b'],
    })

    expect(places).toEqual([
      { kind: 'file', path: join('\\\\wsl.localhost\\Ubuntu\\home\\b', '.claude', '.credentials.json') },
    ])
  })

  it('reads Codex from the Windows home when that is where the Provider runs', () => {
    const places = codexLoginPlaces(null, {
      platform: 'win32',
      env: {},
      home: () => onDisk('/Users/b'),
      runtime: () => ({ kind: 'windows' }),
    })

    expect(places).toEqual([{ kind: 'file', path: join(onDisk('/Users/b'), '.codex', 'auth.json') }])
  })
})
