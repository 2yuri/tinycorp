import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { secretStoreName } from '../../shared/platform/machine-words'
import { keychainSecrets, type SecretStore } from './secrets'

/**
 * The one secret store, with one backend per platform (T136, T176, T177).
 *
 * | Platform | Backend | What keeps the bytes |
 * | --- | --- | --- |
 * | macOS | `keychain` | the login keychain, through `security` (`secrets.ts`) |
 * | Windows | `dpapi` | Electron `safeStorage`, which is DPAPI: this account, this machine |
 * | Linux | `libsecret` | Electron `safeStorage`, which is GNOME Keyring or KWallet |
 *
 * Every secret the app holds goes through it — the boss's MCP tokens and the Environments' values
 * alike — so there is one answer to *where is this kept* and one place a platform without a store
 * is refused. The blobs go in the app's `userData`, never in the Company folder: a Company folder
 * is a folder the boss syncs, zips and hands to somebody, and an encrypted secret is still a
 * secret in transit.
 *
 * **`basic_text` is not encryption.** On a Linux desktop with no keyring running, `safeStorage`
 * falls back to a hard-coded key: `isEncryptionAvailable()` still answers true, and the bytes on
 * disk are readable by anything that knows the algorithm. TinyCorp refuses to store a secret
 * there and says so, rather than drawing a lock over nothing — {@link storageProblem} is that
 * sentence, the Environments tab shows it in place of the table, and a write refuses with it
 * wherever one is attempted.
 *
 * The file is named by a hash of the account, so a variable called `DATABASE_URL` does not become
 * a file called `DATABASE_URL` that says what this Company keeps. The bytes inside are the only
 * copy; nothing here writes a value anywhere else, and a file that will not decrypt is a secret
 * this machine no longer holds rather than an error the app carries around.
 */

/** The part of Electron's `safeStorage` this uses. Injected so a test needs no Electron. */
export interface SafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: which backend was picked. `basic_text` means there is no real encryption. */
  getSelectedStorageBackend?(): string
}

/** What Linux answers when it found no keyring and fell back to a key that is in the source. */
export const UNPROTECTED_BACKEND = 'basic_text'

/**
 * Which of the three stores this machine has, and the two answers that are not a store at all:
 * `none` where nothing can encrypt, and `unprotected` where `safeStorage` would happily write
 * bytes anybody can read back.
 */
export type SecretBackend = 'keychain' | 'dpapi' | 'libsecret' | 'unprotected' | 'none'

/** The backend `platform` would use. The one table the rest of the app reads. */
export function secretBackend(safeStorage: SafeStorage, platform: NodeJS.Platform = process.platform): SecretBackend {
  if (platform === 'darwin') return 'keychain'
  return unprotectedReason(safeStorage) ?? (platform === 'win32' ? 'dpapi' : 'libsecret')
}

/**
 * What `safeStorage` itself says about these bytes, without asking what platform this is: `none`
 * when it cannot encrypt at all, `unprotected` when it would use the key in its own source, and
 * null when it would really encrypt. Every write through the `safeStorage` store asks this, so a
 * desktop whose keyring was closed since the app started refuses the next write rather than the
 * one after the next restart.
 */
function unprotectedReason(safeStorage: SafeStorage): 'none' | 'unprotected' | null {
  if (!safeStorage.isEncryptionAvailable()) return 'none'
  return safeStorage.getSelectedStorageBackend?.() === UNPROTECTED_BACKEND ? 'unprotected' : null
}

/** What the boss is told when this machine cannot encrypt anything at all. */
export const NO_ENCRYPTION_HERE =
  'This machine has no way to encrypt a secret at rest, so TinyCorp will not store one. ' +
  'Sign in with an account that has the system store available, or keep these values out of TinyCorp.'

/** What the boss is told on a Linux desktop with no keyring running. */
export const NO_KEYRING_HERE =
  'There is no keyring running on this desktop, so Electron would "encrypt" these values with a ' +
  'key that is in its own source — anything on this machine could read them back. TinyCorp will ' +
  'not store a secret there. Start GNOME Keyring or KWallet, then reopen TinyCorp.'

/**
 * Why this machine cannot keep a secret, or null when it can. The Environments tab shows it in
 * place of the variables, the Integrations tab shows it when a token is refused, and every write
 * refuses with the same sentence.
 */
export function storageProblem(safeStorage: SafeStorage, platform: NodeJS.Platform = process.platform): string | null {
  return backendProblem(secretBackend(safeStorage, platform))
}

/** The same sentence, for a backend already decided. */
export function backendProblem(backend: SecretBackend): string | null {
  if (backend === 'none') return NO_ENCRYPTION_HERE
  if (backend === 'unprotected') return NO_KEYRING_HERE
  return null
}

export interface SafeStorageSecretsOptions {
  /** The folder the blobs go in, inside `userData`. It is created on the first write. */
  dir: string
  safeStorage: SafeStorage
  /** Where a refusal is said out loud, once, rather than thrown at whoever was saving. */
  log?: (line: string) => void
}

/** The file one account's blob lives in: a hash, so the name says nothing about the secret. */
export function secretFileName(scope: string, key: string): string {
  return `${createHash('sha256').update(`${scope}\u0000${key}`).digest('hex')}.bin`
}

export function safeStorageSecrets({ dir, safeStorage, log = console.warn }: SafeStorageSecretsOptions): SecretStore {
  const fileOf = (scope: string, key: string) => join(dir, secretFileName(scope, key))
  return {
    set(scope, key, secret) {
      // Asked of `safeStorage` rather than of the platform: this store is never the Mac's, and a
      // desktop whose keyring was closed since the app started must refuse this write, not the
      // one after the next restart.
      const problem = backendProblem(unprotectedReason(safeStorage) ?? 'libsecret')
      if (problem) throw new Error(problem)
      mkdirSync(dir, { recursive: true })
      // `0600` is what it means on a Mac and a no-op on Windows, where the ACL of `userData` is
      // what keeps another account out. DPAPI is the part that actually protects the bytes.
      writeFileSync(fileOf(scope, key), safeStorage.encryptString(secret), { mode: 0o600 })
    },

    forget(scope, key) {
      rmSync(fileOf(scope, key), { force: true })
    },

    read(scope, key) {
      try {
        return safeStorage.decryptString(readFileSync(fileOf(scope, key)))
      } catch (error) {
        // No file is the ordinary case and says nothing; a file that will not decrypt is worth one line.
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') log(`A stored secret could not be decrypted on this machine: ${String(error)}`)
        return null
      }
    },
  }
}

/**
 * The store this machine has, by its backend: the keychain on a Mac, a `safeStorage` blob in
 * `userData` under DPAPI on Windows and under libsecret on Linux. The app calls this once; every
 * test hands in `memorySecrets()` instead and touches neither.
 *
 * A machine with no real store still gets the `safeStorage` store, because refusing is its job:
 * it throws {@link storageProblem}'s sentence at whoever tried to save, and the screens that can
 * ask ahead of time say it before the boss types a token.
 */
export function platformSecrets(options: {
  /** Where the blobs go when there is no keychain. */
  dir: string
  safeStorage: SafeStorage
  platform?: NodeJS.Platform
}): SecretStore {
  return secretBackend(options.safeStorage, options.platform ?? process.platform) === 'keychain'
    ? keychainSecrets()
    : safeStorageSecrets(options)
}

/**
 * {@link secretStoreName}'s words, from the backend already decided rather than from the platform
 * (T218). A sentence a boss reads about where their value is kept goes through this, so none of
 * them promises a keychain to a desktop that has a keyring.
 */
export function namedSecretStore(backend: SecretBackend): string {
  if (backend === 'keychain') return secretStoreName('darwin')
  if (backend === 'dpapi') return secretStoreName('win32')
  return secretStoreName('linux')
}

/**
 * Where a secret is kept on this machine, in the words the settings screens show. One sentence
 * per backend, here rather than in each screen, so no tab can tell the boss their token is in a
 * keychain this machine does not have.
 */
export function whereSecretsLive(backend: SecretBackend, companyName: string): string {
  if (backend === 'keychain') return `this Mac\u2019s keychain, as TinyCorp / ${companyName}`
  if (backend === 'dpapi') return 'this Windows account\u2019s encrypted store (DPAPI), in TinyCorp\u2019s own app data'
  return 'this desktop\u2019s keyring, in TinyCorp\u2019s own app data'
}
