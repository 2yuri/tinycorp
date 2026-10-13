import { execFileSync } from 'node:child_process'
import { OAUTH_TOKEN_ENV } from '../claude/adapter'
import { subscriptionEnv } from '../subscription-env'

export { subscriptionEnv }

/**
 * How a real `claude` authenticates: the long-lived token from `claude setup-token` (CI), or
 * the developer's own subscription login (local). Never an API key.
 */
export type ClaudeCredential = { kind: 'token' } | { kind: 'login' }

/** The subscription credential available in `env`, or null. `authStatus` prints `claude auth status` JSON. */
export function claudeCredential(
  env: NodeJS.ProcessEnv,
  authStatus: () => string | null = () => claudeAuthStatus(env),
): ClaudeCredential | null {
  if (env[OAUTH_TOKEN_ENV]?.trim()) return { kind: 'token' }
  const output = authStatus()
  if (!output) return null
  try {
    const status = JSON.parse(output) as { loggedIn?: unknown; authMethod?: unknown }
    return status.loggedIn === true && status.authMethod === 'claude.ai' ? { kind: 'login' } : null
  } catch {
    return null
  }
}

/** `claude auth status` as a Session would see it, or null when `claude` is missing or fails. */
function claudeAuthStatus(env: NodeJS.ProcessEnv): string | null {
  const clean = Object.fromEntries(
    Object.entries(subscriptionEnv(env)).filter(([name]) => !name.startsWith('CLAUDE') || name === OAUTH_TOKEN_ENV),
  )
  try {
    return execFileSync('claude', ['auth', 'status'], {
      env: clean,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    })
  } catch {
    return null
  }
}
