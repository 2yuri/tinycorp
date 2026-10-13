import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { onPath } from '../../platform'

/**
 * How a real `opencode` authenticates: the login `opencode auth login` wrote into its data
 * folder's `auth.json`. OpenCode holds no account of its own — it signs in to whichever product
 * the boss already pays for — so the credential is "there is at least one provider in there, and
 * it is not an API key" (decision 3: every Employee runs on the boss's subscription).
 *
 * `OPENCODE_API_KEY` and `OPENCODE_AUTH_CONTENT` never count as one and never reach a Session.
 */
export type OpencodeCredential = { kind: 'login'; providers: string[] }

/** Variables that would let `opencode` bill a key instead of the boss's own login. */
const API_KEY_ENV = ['OPENCODE_API_KEY', 'OPENCODE_AUTH_CONTENT']

/** Where OpenCode keeps the boss's logins: its XDG data folder, which no OPENCODE_* var names. */
export function opencodeDataDir(env: NodeJS.ProcessEnv): string {
  const home = env['HOME'] ?? homedir()
  return join(env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), 'opencode')
}

/**
 * The subscription credential available to `opencode`, or null — which is also what a machine
 * without `opencode` installed answers, so the integration test skips itself there.
 */
export function opencodeCredential(
  env: NodeJS.ProcessEnv,
  readAuth: () => string | null = () => readOpencodeAuth(env),
  installed: () => boolean = () => onPath('opencode', env),
): OpencodeCredential | null {
  if (!installed()) return null
  const raw = readAuth()
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const providers = Object.entries(parsed as Record<string, unknown>)
    .filter(([, login]) => typeof login === 'object' && login !== null)
    .map(([provider]) => provider)
  return providers.length > 0 ? { kind: 'login', providers } : null
}

/** `env` without API keys, so a Session can only use the login. */
export function subscriptionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !API_KEY_ENV.includes(name)))
}

function readOpencodeAuth(env: NodeJS.ProcessEnv): string | null {
  try {
    return readFileSync(join(opencodeDataDir(env), 'auth.json'), 'utf8')
  } catch {
    return null
  }
}
