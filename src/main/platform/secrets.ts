import { execFileSync } from 'node:child_process'

/**
 * The OS keychain, as the only place a token the boss typed is kept (T136).
 *
 * A secret never reaches the Company database, a log line or `argv`: it is written under the
 * Company and the thing it belongs to, read back only at spawn, and handed to the process in its
 * environment or in a `0600` config file the adapter writes. Nothing in the app reads one to show
 * it — the settings row says whether there is one, and that is all it can say.
 *
 * It is a seam so tests never touch the machine's real keychain, and so a platform without one can
 * be given its own store later.
 */
export interface SecretStore {
  /** Stores a secret, replacing whatever was under the same account. */
  set(scope: string, key: string, secret: string): void
  /** Forgets it. A secret that was not there is not an error. */
  forget(scope: string, key: string): void
  /** The stored secret, or null when there is none. Never logged, never returned over IPC. */
  read(scope: string, key: string): string | null
}

/** The keychain service every TinyCorp secret is filed under. */
export const SECRET_SERVICE = 'TinyCorp MCP'

/** How long `security` is given before a hung keychain stops being waited on. */
const SECURITY_TIMEOUT_MS = 10_000

/**
 * One run of `security`. Injected so a test can read the arguments and the stdin without a
 * keychain — which is the only way to assert that no secret was ever an argument.
 */
export type RunSecurity = (args: string[], input?: string) => string

/**
 * The macOS keychain, through `security`.
 *
 * The write goes over **stdin**, in `security -i`'s own command language, rather than on the
 * command line: `security add-generic-password … -w <secret>` would put the token in `argv`, where
 * `ps` reads it. The read names only the service and the account, so nothing secret is ever an
 * argument.
 */
export function keychainSecrets(run: RunSecurity = runSecurity): SecretStore {
  const account = (scope: string, key: string) => `${scope}:${key}`
  return {
    set(scope, key, secret) {
      run(
        ['-i'],
        `add-generic-password -U -s ${quote(SECRET_SERVICE)} -a ${quote(account(scope, key))} -w ${quote(secret)}\n`,
      )
    },
    forget(scope, key) {
      try {
        run(['delete-generic-password', '-s', SECRET_SERVICE, '-a', account(scope, key)])
      } catch {
        // No item under that account: there is nothing to forget.
      }
    },
    read(scope, key) {
      try {
        const out = run(['find-generic-password', '-s', SECRET_SERVICE, '-a', account(scope, key), '-w'])
        // `security` prints the password and a newline; a password of its own is never trimmed.
        return out.replace(/\n$/, '')
      } catch {
        // No item, a locked keychain, or the boss refused the prompt: this Session gets no secret.
        return null
      }
    },
  }
}

const runSecurity: RunSecurity = (args, input) =>
  execFileSync('security', args, { input, encoding: 'utf8', timeout: SECURITY_TIMEOUT_MS })

/**
 * One argument of a `security -i` line: `security` reads these the way a shell reads quotes.
 *
 * `security -i` reads **one command per line**, and a newline is the one thing quoting cannot hold:
 * it would end the `add-generic-password` line early and whatever followed would be parsed as
 * another `security` subcommand, running as the boss against the boss's keychain (T199-H3). Nothing
 * this app stores legitimately has one, so a value with a newline in it is refused rather than
 * escaped — the write never reaches `security` at all.
 */
export function quote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('A keychain value cannot contain a newline')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** A store that keeps secrets in this process only. Tests and the fixtures use it; the app does not. */
export function memorySecrets(): SecretStore {
  const held = new Map<string, string>()
  const at = (scope: string, key: string) => `${scope}:${key}`
  return {
    set: (scope, key, secret) => void held.set(at(scope, key), secret),
    forget: (scope, key) => void held.delete(at(scope, key)),
    read: (scope, key) => held.get(at(scope, key)) ?? null,
  }
}
