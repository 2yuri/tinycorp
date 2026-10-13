/**
 * The words that name the machine the boss is on (T177, T265).
 *
 * Every screen was drawn on a Mac, so every screen said *this Mac*, *Reveal in Finder* and *the
 * keychain* — and the Windows build told its boss to add a repository from anywhere on this Mac.
 * A Mac word is the right word on a Mac and only there: this file is the one place any of them is
 * written, as a function of the platform, and `no-mac-words.test.ts` fails on one written anywhere
 * else. The Mac column is the Pen frames' own words, so a capture harness — which reads as macOS —
 * draws exactly what it drew before.
 *
 * The secret store's words follow the backend `src/main/platform/safe-storage-secrets.ts` really
 * uses: the keychain on macOS, Electron `safeStorage` on Windows — DPAPI, tied to the Windows
 * account, which is not Credential Manager and is not called that here — and the keyring on Linux.
 */

/** What a sentence says for the machine, the file manager, the secret store and the modifier. */
export interface MachineWords {
  /** `Add a repository from anywhere on <this>`: `this Mac`, `this PC`, `this computer`. */
  machine: string
  /** The menu item that shows a file in the file manager, capitalised as a label. */
  reveal: string
  /** `Show notes.md in <this>`: `Finder`, `File Explorer`, `your file manager`. */
  fileManager: string
  /** The two or three words a chip or a helper has room for: `the keychain`, `the keyring`. */
  secretStore: string
  /** The store as a step's title: `Keychain`, `Encrypted store`, `Keyring`. */
  secretStoreTitle: string
  /** The modifier key, spelt out as a hint prints it: `Cmd` on a Mac, `Ctrl` everywhere else. */
  modifier: string
}

const MAC: MachineWords = {
  machine: 'this Mac',
  reveal: 'Reveal in Finder',
  fileManager: 'Finder',
  secretStore: 'the keychain',
  secretStoreTitle: 'Keychain',
  modifier: 'Cmd',
}

const WINDOWS: MachineWords = {
  machine: 'this PC',
  reveal: 'Show in File Explorer',
  fileManager: 'File Explorer',
  secretStore: 'the encrypted store',
  secretStoreTitle: 'Encrypted store',
  modifier: 'Ctrl',
}

/** A Linux desktop has no one file manager, so it is never named. */
const LINUX: MachineWords = {
  machine: 'this computer',
  reveal: 'Show in folder',
  fileManager: 'your file manager',
  secretStore: 'the keyring',
  secretStoreTitle: 'Keyring',
  modifier: 'Ctrl',
}

export function machineWords(platform: NodeJS.Platform | string): MachineWords {
  if (platform === 'darwin') return MAC
  if (platform === 'win32') return WINDOWS
  return LINUX
}

/**
 * A catalogue sentence with the machine's words put in: `{machine}` and `{secretStore}` are the
 * two a table of data writes in their place, because a table is written once and read on every
 * platform.
 */
export function inMachineWords(text: string, platform: NodeJS.Platform | string): string {
  const words = machineWords(platform)
  return text.replaceAll('{machine}', words.machine).replaceAll('{secretStore}', words.secretStore)
}

/** `Stored in <this>`: the store, named, with the article. */
export function secretStoreName(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return 'the macOS keychain'
  if (platform === 'win32') return 'this Windows account’s encrypted store'
  return 'this desktop’s keyring'
}

/** The two or three words a chip or a row has space for: `the keychain`, `the keyring`. */
export function secretStoreShort(platform: NodeJS.Platform | string): string {
  return machineWords(platform).secretStore
}
