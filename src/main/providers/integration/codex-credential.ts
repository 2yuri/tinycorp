import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CODEX_HOME_ENV } from '../codex/adapter'

/**
 * How a real `codex` authenticates: the ChatGPT login `codex login` wrote into
 * `$CODEX_HOME/auth.json`. Never an API key — decision 3 is that every Employee runs on the
 * boss's subscription, and CI supplies one by pointing `CODEX_HOME` at a login of its own.
 */
export type CodexCredential = { kind: 'login' }

/** Variables that would make `codex` bill an API key instead of the subscription. */
const API_KEY_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY']

/** Where `codex` keeps the boss's login. */
export function codexHome(env: NodeJS.ProcessEnv): string {
  return env[CODEX_HOME_ENV] ?? join(env['HOME'] ?? homedir(), '.codex')
}

/** The subscription credential available to `codex`, or null. `readAuth` reads its `auth.json`. */
export function codexCredential(
  env: NodeJS.ProcessEnv,
  readAuth: () => string | null = () => readCodexAuth(env),
): CodexCredential | null {
  const raw = readAuth()
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { tokens } = parsed as { tokens?: unknown }
  if (typeof tokens !== 'object' || tokens === null) return null
  const { access_token: accessToken } = tokens as { access_token?: unknown }
  return typeof accessToken === 'string' && accessToken.trim() ? { kind: 'login' } : null
}

/** `env` without API keys, so a Session can only use the subscription. */
export function subscriptionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !API_KEY_ENV.includes(name)))
}

function readCodexAuth(env: NodeJS.ProcessEnv): string | null {
  try {
    return readFileSync(join(codexHome(env), 'auth.json'), 'utf8')
  } catch {
    return null
  }
}
