import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../core/testing'
import {
  NO_ENCRYPTION_HERE,
  NO_KEYRING_HERE,
  platformSecrets,
  type SafeStorage,
  type SecretBackend,
  safeStorageSecrets,
  secretBackend,
  secretFileName,
  storageProblem,
  UNPROTECTED_BACKEND,
  whereSecretsLive,
} from './safe-storage-secrets'

/**
 * The store a machine without a macOS keychain gets (T176): Electron's `safeStorage`, which is
 * DPAPI on Windows, over files in the app's own `userData`.
 *
 * `safeStorage` is stood in for, because a test cannot boot Electron — what is being checked here
 * is that the plain value never reaches a file, that a file is named after nothing, and that a
 * blob this machine cannot decrypt is a secret it no longer holds rather than a crash.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function dir(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-safe-'))
  folders.push(folder)
  return join(folder, 'secrets')
}

/** What Windows has: DPAPI, and no `getSelectedStorageBackend` at all — the method is not there. */
function fakeDpapiStorage(): SafeStorage {
  const { getSelectedStorageBackend: _windowsHasNone, ...dpapi } = fakeSafeStorage()
  return dpapi
}

/** A stand-in for Electron's, with an obvious reversible "encryption" the test can recognise. */
function fakeSafeStorage(available = true, backend = 'gnome_libsecret'): SafeStorage {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (plain) => Buffer.from(`dpapi:${[...plain].reverse().join('')}`),
    decryptString(encrypted) {
      const text = encrypted.toString('utf8')
      if (!text.startsWith('dpapi:')) throw new Error('not ours')
      return [...text.slice('dpapi:'.length)].reverse().join('')
    },
  }
}

const VALUE = 'postgres://app:h7fs8@db.internal:5432/billing'

describe('The safeStorage secret store', () => {
  it('writes and reads a secret back, keeping Companies and names apart', () => {
    const store = safeStorageSecrets({ dir: dir(), safeStorage: fakeSafeStorage() })

    store.set('company-1', 'env:prod:DATABASE_URL', VALUE)
    store.set('company-2', 'env:prod:DATABASE_URL', 'another-value-entirely')

    expect(store.read('company-1', 'env:prod:DATABASE_URL')).toBe(VALUE)
    expect(store.read('company-2', 'env:prod:DATABASE_URL')).toBe('another-value-entirely')
    expect(store.read('company-3', 'env:prod:DATABASE_URL')).toBeNull()
  })

  it('never writes the value, or the name, in plain sight', () => {
    const folder = dir()
    const store = safeStorageSecrets({ dir: folder, safeStorage: fakeSafeStorage() })

    store.set('company-1', 'env:prod:DATABASE_URL', VALUE)

    const files = readdirSync(folder)
    expect(files).toEqual([secretFileName('company-1', 'env:prod:DATABASE_URL')])
    expect(files[0]).not.toContain('DATABASE_URL')
    expect(readFileSync(join(folder, files[0]!), 'utf8')).not.toContain(VALUE)
  })

  it('forgets a secret, and forgetting one that was never there is not an error', () => {
    const store = safeStorageSecrets({ dir: dir(), safeStorage: fakeSafeStorage() })
    store.set('company-1', 'env:prod:DATABASE_URL', VALUE)

    store.forget('company-1', 'env:prod:DATABASE_URL')

    expect(store.read('company-1', 'env:prod:DATABASE_URL')).toBeNull()
    expect(() => store.forget('company-1', 'never-existed')).not.toThrow()
  })

  it('refuses to store anything on a machine that cannot encrypt at rest', () => {
    const store = safeStorageSecrets({ dir: dir(), safeStorage: fakeSafeStorage(false) })

    expect(() => store.set('company-1', 'env:prod:DATABASE_URL', VALUE)).toThrow(/no way to encrypt/)
  })

  it('refuses a Linux desktop with no keyring, where the "encryption" key is in the source', () => {
    const folder = dir()
    const store = safeStorageSecrets({ dir: folder, safeStorage: fakeSafeStorage(true, UNPROTECTED_BACKEND) })

    expect(() => store.set('company-1', 'env:prod:DATABASE_URL', VALUE)).toThrow(/no keyring running/)
    expect(() => readdirSync(folder)).toThrow()
  })

  it('answers null, with one line in the log, for a blob this machine cannot decrypt', () => {
    const folder = dir()
    const lines: string[] = []
    const store = safeStorageSecrets({ dir: folder, safeStorage: fakeSafeStorage(), log: (line) => lines.push(line) })
    store.set('company-1', 'env:prod:DATABASE_URL', VALUE)
    writeFileSync(join(folder, secretFileName('company-1', 'env:prod:DATABASE_URL')), 'written by another account')

    expect(store.read('company-1', 'env:prod:DATABASE_URL')).toBeNull()
    expect(lines).toHaveLength(1)
  })

  it('says nothing at all about a secret that is simply not there', () => {
    const lines: string[] = []
    const store = safeStorageSecrets({ dir: dir(), safeStorage: fakeSafeStorage(), log: (line) => lines.push(line) })

    expect(store.read('company-1', 'nothing')).toBeNull()
    expect(lines).toEqual([])
  })
})

describe('The store this platform has', () => {
  it('is the safeStorage one away from a Mac', () => {
    const store = platformSecrets({ dir: dir(), safeStorage: fakeSafeStorage(), platform: 'win32' })

    store.set('company-1', 'env:prod:DATABASE_URL', VALUE)

    expect(store.read('company-1', 'env:prod:DATABASE_URL')).toBe(VALUE)
  })

  it('is the safeStorage one on Linux too, and it really keeps a value there', () => {
    const store = platformSecrets({
      dir: dir(),
      safeStorage: fakeSafeStorage(true, 'gnome_libsecret'),
      platform: 'linux',
    })

    store.set('company-1', 'mcp:linear', 'lin_api_abc')

    expect(store.read('company-1', 'mcp:linear')).toBe('lin_api_abc')
  })

  /**
   * The Mac's store is the keychain and nothing else. Nothing is read here: the suite never
   * touches the machine's real keychain, so what is checked is the choice, which is the part that
   * could go wrong — a Mac must not be handed the `safeStorage` store because a fake said so.
   */
  it('is the keychain on a Mac, whatever safeStorage would have answered', () => {
    expect(secretBackend(fakeSafeStorage(false, UNPROTECTED_BACKEND), 'darwin')).toBe('keychain')
  })
})

/**
 * One module, three backends (T177). Every screen that says where a value is kept, and every
 * refusal, reads this one table — so a Linux boss is never told their token is in a keychain,
 * and a desktop with no keyring is never told anything was encrypted.
 */
describe('Which backend this machine has', () => {
  const cases: [NodeJS.Platform, SafeStorage, SecretBackend][] = [
    ['darwin', fakeSafeStorage(), 'keychain'],
    // A Mac is the keychain whatever safeStorage says, because safeStorage is not what is used.
    ['darwin', fakeSafeStorage(false, UNPROTECTED_BACKEND), 'keychain'],
    ['win32', fakeDpapiStorage(), 'dpapi'],
    ['linux', fakeSafeStorage(true, 'gnome_libsecret'), 'libsecret'],
    ['linux', fakeSafeStorage(true, 'kwallet6'), 'libsecret'],
    ['linux', fakeSafeStorage(true, UNPROTECTED_BACKEND), 'unprotected'],
    ['linux', fakeSafeStorage(false), 'none'],
    ['win32', fakeSafeStorage(false), 'none'],
  ]

  it.each(cases)('on %s answers %#', (platform, safeStorage, expected) => {
    expect(secretBackend(safeStorage, platform)).toBe(expected)
  })

  it('refuses `basic_text` as a backend, because it is a key that is in the source', () => {
    expect(secretBackend(fakeSafeStorage(true, UNPROTECTED_BACKEND), 'linux')).toBe('unprotected')
    expect(storageProblem(fakeSafeStorage(true, UNPROTECTED_BACKEND), 'linux')).toBe(NO_KEYRING_HERE)
    expect(storageProblem(fakeSafeStorage(false), 'linux')).toBe(NO_ENCRYPTION_HERE)
  })

  it('says where a value is kept, in words that match the backend and no other', () => {
    expect(whereSecretsLive('keychain', 'Acme')).toContain('keychain')
    expect(whereSecretsLive('keychain', 'Acme')).toContain('Acme')
    expect(whereSecretsLive('dpapi', 'Acme')).toContain('DPAPI')
    expect(whereSecretsLive('libsecret', 'Acme')).toContain('keyring')
    // Nowhere but the Mac may say keychain: that is the sentence T177 came to fix.
    expect(whereSecretsLive('dpapi', 'Acme')).not.toContain('keychain')
    expect(whereSecretsLive('libsecret', 'Acme')).not.toContain('keychain')
  })
})

describe('Whether this machine can keep a secret', () => {
  it('says nothing on a Mac, whatever safeStorage answers: the keychain is what is used there', () => {
    expect(storageProblem(fakeSafeStorage(false, UNPROTECTED_BACKEND), 'darwin')).toBeNull()
  })

  it('says nothing on a Windows with DPAPI, which has no backend to name', () => {
    const dpapi: SafeStorage = fakeDpapiStorage()

    expect(storageProblem(dpapi, 'win32')).toBeNull()
  })

  it('names the keyring, and what to do about it, on a Linux without one', () => {
    const problem = storageProblem(fakeSafeStorage(true, UNPROTECTED_BACKEND), 'linux')

    expect(problem).toMatch(/no keyring running/)
    expect(problem).toMatch(/GNOME Keyring or KWallet/)
  })

  it('says nothing on a Linux whose keyring is up', () => {
    expect(storageProblem(fakeSafeStorage(true, 'kwallet6'), 'linux')).toBeNull()
  })
})
