/**
 * Variables that would make a Claude Code Session bill an API key instead of the boss's own
 * subscription (decision 3). They live here rather than beside the adapter because this is the
 * module that strips them, and the adapter imports this one.
 */
export const API_KEY_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * Keeping an API key away from a Session (decision 3, T129). Every Employee is the boss's own
 * subscription; an inherited `ANTHROPIC_API_KEY` would quietly bill a different account instead,
 * so it is stripped from the environment a Session is spawned into and from every `claude` the
 * app runs to ask a question.
 */
export function subscriptionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isApiKeyVar(name)))
}

/** The API-key variables actually set around the app, in the order the card names them. */
export function apiKeyVarsIn(env: NodeJS.ProcessEnv): string[] {
  return API_KEY_ENV.filter((name) => env[name]?.trim())
}

function isApiKeyVar(name: string): boolean {
  return (API_KEY_ENV as readonly string[]).includes(name)
}
