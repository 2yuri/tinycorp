import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AccountStore, StoredAccount } from './provider-accounts'

/**
 * The boss's Provider sign-ins kept as a JSON file, normally `provider-accounts.json` beside the
 * boss profile in Electron's userData folder (T173).
 *
 * It holds a label and a config directory per account — **never a credential**. What signs an
 * account in lives inside that directory, written by the product's own login, and nothing here
 * reads it.
 */
export function accountsFile(file: string): AccountStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        return Array.isArray(parsed) ? parsed.filter(isAccount) : null
      } catch {
        // No file yet, or one nobody can parse: the boss simply has the Providers' own sign-ins.
        return null
      }
    },
    write(accounts) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(accounts, null, 2))
    },
  }
}

function isAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<StoredAccount>
  return (
    typeof row.id === 'string' &&
    typeof row.provider === 'string' &&
    typeof row.label === 'string' &&
    (row.configDir === null || typeof row.configDir === 'string') &&
    typeof row.isDefault === 'boolean'
  )
}
