import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onDisk } from '../../core/testing'
import { codexCredential, codexHome, subscriptionEnv } from './codex-credential'

const auth = (tokens: Record<string, unknown>) => () => JSON.stringify({ auth_mode: 'chatgpt', tokens })

describe('Codex credential for the real-Codex integration test', () => {
  it('uses the developer’s ChatGPT login', () => {
    expect(codexCredential({}, auth({ access_token: 'oauth-1', account_id: 'acct-1' }))).toEqual({ kind: 'login' })
  })

  it('never counts an API key as a credential, whichever name it is under (decision 3)', () => {
    // An API key in the environment does not stand in for a login, and does not survive into the
    // Session either: `codex` must have no way to bill anything but the subscription.
    const keys = { OPENAI_API_KEY: 'sk-1', CODEX_API_KEY: 'sk-2' }

    expect(codexCredential(keys, () => null)).toBeNull()
    expect(codexCredential(keys, auth({ access_token: 'oauth-1' }))).toEqual({ kind: 'login' })
    for (const name of Object.keys(keys)) expect(subscriptionEnv(keys)[name]).toBeUndefined()
  })

  it('is absent when nobody is logged in, codex is missing or its auth is unreadable', () => {
    expect(codexCredential({}, () => null)).toBeNull()
    expect(codexCredential({}, () => 'not json')).toBeNull()
    expect(codexCredential({}, auth({}))).toBeNull()
    expect(codexCredential({}, auth({ access_token: '  ' }))).toBeNull()
    expect(codexCredential({}, () => JSON.stringify({ auth_mode: 'chatgpt' }))).toBeNull()
  })

  it('reads the login from CODEX_HOME when the boss moved it', () => {
    expect(codexHome({ CODEX_HOME: onDisk('/elsewhere/codex') })).toBe(onDisk('/elsewhere/codex'))
    expect(codexHome({ HOME: onDisk('/home/ada') })).toBe(join(onDisk('/home/ada'), '.codex'))
  })

  it('removes API keys from the environment a Session inherits', () => {
    const env = subscriptionEnv({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-1',
      CODEX_API_KEY: 'sk-2',
      CODEX_HOME: onDisk('/home/ada/.codex'),
    })

    expect(env).toEqual({ PATH: '/usr/bin', CODEX_HOME: onDisk('/home/ada/.codex') })
  })
})
