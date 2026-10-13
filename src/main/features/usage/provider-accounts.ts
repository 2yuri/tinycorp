import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROVIDERS } from '../../../shared/domain/providers'
import { accountLabel, PRIMARY_ACCOUNT_LABEL, type ProviderAccount } from '../../../shared/usage/provider-accounts'
import type { ProviderAccountSupport, ProviderAdapters, SpawnAccount } from '../../providers'

/**
 * Where the boss's accounts are remembered, app-wide: they are sign-ins of one person, not of one
 * Company (frame `A2lOk0` puts them in Your profile). Holds labels and directories — never a
 * credential, which stays wherever the product's own login wrote it.
 */
export interface AccountStore {
  read(): StoredAccount[] | null
  write(accounts: StoredAccount[]): void
}

/** One account as the store keeps it. Identity is read from the CLI, so it is not stored. */
export interface StoredAccount {
  id: string
  provider: string
  label: string
  /** Absolute, and always inside the app's own accounts folder — a primary account has none. */
  configDir: string | null
  isDefault: boolean
}

/** A store that forgets when the process ends, for tests and for a headless engine. */
export function memoryAccounts(initial: StoredAccount[] = []): AccountStore {
  let held = [...initial]
  return {
    read: () => [...held],
    write(accounts) {
      held = [...accounts]
    },
  }
}

export interface ProviderAccountsOptions {
  store: AccountStore
  providers: ProviderAdapters
  /** The app's own folder for account config directories. One directory per added account. */
  dataDir: string
  /** Makes the directory a new account signs in inside. Injected so tests touch no disk. */
  makeDir?: ((path: string) => void) | undefined
  log?: (line: string) => void
}

/** The boss's sign-ins per Provider, and what a Session is spawned with to run as one (T173). */
export interface ProviderAccounts {
  /** Every account, in Provider order then the boss's own order. */
  list(): ProviderAccount[]
  /** The accounts of one Provider, the primary one first. Empty for a Provider that keeps one sign-in. */
  of(provider: string): ProviderAccount[]
  /** Whether this Provider's CLI can hold more than one sign-in at all. */
  supportsAccounts(provider: string): boolean
  /** Adds a sign-in with its own directory. Nothing is signed in yet: the sign-in modal does that (T263). */
  add(provider: string, label: string): ProviderAccount
  /** Renames one. */
  rename(id: string, label: string): ProviderAccount
  /** The one an Employee takes when nothing pins it. */
  setDefault(id: string): ProviderAccount
  /** Forgets an account. The directory is left on disk, so nothing signs the boss out behind them. */
  remove(id: string): void
  /** What a Session is spawned with to run as this account, or null when there is nothing to say. */
  spawnAccount(id: string | null): SpawnAccount | null
  /** Called after any account changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void
}

export function createProviderAccounts({
  store,
  providers,
  dataDir,
  makeDir = (path: string) => mkdirSync(path, { recursive: true }),
  log = console.warn,
}: ProviderAccountsOptions): ProviderAccounts {
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const adapterOf = (provider: string) => providers[provider as keyof ProviderAdapters]
  const supportOf = (provider: string) => adapterOf(provider)?.accounts?.() ?? null

  /** The address the product wrote beside this sign-in, where it writes one (T263). Never the login. */
  function emailIn(support: ProviderAccountSupport, configDir: string): string | null {
    try {
      return support.email?.(configDir) ?? null
    } catch {
      return null
    }
  }

  function stored(): StoredAccount[] {
    try {
      return store.read() ?? []
    } catch (error) {
      log(`Accounts: could not read the stored accounts: ${(error as Error).message}`)
      return []
    }
  }

  function save(accounts: StoredAccount[]): void {
    store.write(accounts)
    notify()
  }

  /**
   * The primary account of a Provider: the product's own directory, as the boss already signed it
   * in. It is not stored — it exists as long as the Provider says where its default directory is —
   * and it cannot be removed, which is what keeps `Add another account` from stranding the boss.
   */
  function primaryOf(provider: string): ProviderAccount | null {
    const support = supportOf(provider)
    if (!support) return null
    const rows = stored().filter((row) => row.provider === provider)
    return {
      id: primaryId(provider),
      provider,
      label: rows.find((row) => row.id === primaryId(provider))?.label ?? PRIMARY_ACCOUNT_LABEL,
      plan: null,
      email: emailIn(support, support.defaultDir),
      configDir: support.defaultDir,
      isDefault: !rows.some((row) => row.isDefault && row.configDir !== null),
      primary: true,
    }
  }

  function accountsOf(provider: string): ProviderAccount[] {
    const primary = primaryOf(provider)
    if (!primary) return []
    const added = stored()
      .filter((row) => row.provider === provider && row.configDir !== null)
      .map(
        (row): ProviderAccount => ({
          id: row.id,
          provider,
          label: row.label,
          plan: null,
          email: emailIn(supportOf(provider)!, row.configDir!),
          configDir: row.configDir!,
          isDefault: row.isDefault,
          primary: false,
        }),
      )
    return [primary, ...added]
  }

  function find(id: string): ProviderAccount | null {
    const provider = providerOfPrimary(id) ?? providerOfStored(id)
    if (!provider) return null
    return accountsOf(provider).find((account) => account.id === id) ?? null
  }

  function providerOfPrimary(id: string): string | null {
    const match = /^primary:(.+)$/.exec(id)
    return match ? (match[1] ?? null) : null
  }

  function providerOfStored(id: string): string | null {
    return stored().find((row) => row.id === id)?.provider ?? null
  }

  const accounts: ProviderAccounts = {
    list: () => PROVIDERS.flatMap((provider) => accountsOf(provider)),

    of: accountsOf,

    supportsAccounts: (provider) => supportOf(provider) !== null,

    add(provider, label) {
      const support = supportOf(provider)
      if (!support) throw new Error(`${provider} keeps one sign-in — it has no config directory to point at`)
      const name = accountLabel(label)
      if (!name) throw new Error('An account needs a label')
      const id = randomUUID()
      const configDir = join(dataDir, provider, id)
      makeDir(configDir)
      save([...stored(), { id, provider, label: name, configDir, isDefault: false }])
      return find(id)!
    },

    rename(id, label) {
      const name = accountLabel(label)
      if (!name) throw new Error('An account needs a label')
      const rows = stored()
      const row = rows.find((entry) => entry.id === id)
      if (row) save(rows.map((entry) => (entry.id === id ? { ...entry, label: name } : entry)))
      else {
        // The primary account has no stored row until the boss renames it; this is that row.
        const provider = providerOfPrimary(id)
        if (!provider) throw new Error(`Unknown account: ${id}`)
        save([...rows, { id, provider, label: name, configDir: null, isDefault: false }])
      }
      const found = find(id)
      if (!found) throw new Error(`Unknown account: ${id}`)
      return found
    },

    setDefault(id) {
      const found = find(id)
      if (!found) throw new Error(`Unknown account: ${id}`)
      const rows = stored().map((row) => (row.provider === found.provider ? { ...row, isDefault: row.id === id } : row))
      save(rows)
      return find(id)!
    },

    remove(id) {
      if (providerOfPrimary(id)) throw new Error('The first sign-in of a Provider cannot be removed')
      const rows = stored()
      if (!rows.some((row) => row.id === id)) return
      save(rows.filter((row) => row.id !== id))
    },

    spawnAccount(id) {
      if (!id) return null
      const found = find(id)
      return found ? { id: found.id, configDir: found.configDir } : null
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return accounts
}

/** The id of a Provider's primary account: its own directory, which is not stored. */
export function primaryId(provider: string): string {
  return `primary:${provider}`
}
