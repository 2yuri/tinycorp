import { describe, expect, it } from 'vitest'
import { claudeCredential, subscriptionEnv } from './claude-credential'

const loggedIn = (authMethod: string) => () => JSON.stringify({ loggedIn: true, authMethod })

describe('Claude credential for the real-Claude integration test', () => {
  it('uses the long-lived token from `claude setup-token` when one is set', () => {
    const credential = claudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1' }, () => {
      throw new Error('status not needed')
    })

    expect(credential).toEqual({ kind: 'token' })
  })

  it('uses the developer’s subscription login otherwise', () => {
    expect(claudeCredential({}, loggedIn('claude.ai'))).toEqual({ kind: 'login' })
  })

  it('never counts an API key as a credential', () => {
    expect(claudeCredential({ ANTHROPIC_API_KEY: 'sk-ant-api-1' }, loggedIn('api_key'))).toBeNull()
  })

  it('is absent when nobody is logged in, claude is missing or its status is unreadable', () => {
    expect(claudeCredential({}, () => JSON.stringify({ loggedIn: false }))).toBeNull()
    expect(claudeCredential({}, () => null)).toBeNull()
    expect(claudeCredential({}, () => 'not json')).toBeNull()
  })

  it('treats a blank token as no token', () => {
    expect(claudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: ' ' }, () => null)).toBeNull()
  })

  it('removes API keys from the environment a Session inherits', () => {
    const env = subscriptionEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-api-1',
      ANTHROPIC_AUTH_TOKEN: 'x',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1',
    })

    expect(env).toEqual({ PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1' })
  })
})
