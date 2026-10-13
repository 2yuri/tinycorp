import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onDisk } from '../../core/testing'
import { opencodeCredential, opencodeDataDir, subscriptionEnv } from './opencode-credential'

const here = () => true
const auth = (logins: Record<string, unknown>) => () => JSON.stringify(logins)

describe('OpenCode credential for the real-OpenCode integration test', () => {
  it('uses whichever account the boss signed OpenCode in with', () => {
    const login = auth({ 'github-copilot': { type: 'oauth', access: 'tok', refresh: 'r', expires: 1 } })

    expect(opencodeCredential({}, login, here)).toEqual({ kind: 'login', providers: ['github-copilot'] })
  })

  it('never counts an API key as a credential, whichever name it is under (decision 3)', () => {
    const keys = { OPENCODE_API_KEY: 'sk-1', OPENCODE_AUTH_CONTENT: '{"anthropic":{}}' }

    expect(opencodeCredential(keys, () => null, here)).toBeNull()
    for (const name of Object.keys(keys)) expect(subscriptionEnv(keys)[name]).toBeUndefined()
  })

  it('is absent when nobody is logged in, or its auth is unreadable', () => {
    expect(opencodeCredential({}, () => null, here)).toBeNull()
    expect(opencodeCredential({}, () => 'not json', here)).toBeNull()
    expect(opencodeCredential({}, auth({}), here)).toBeNull()
    expect(opencodeCredential({}, () => '[]', here)).toBeNull()
  })

  it('is absent on a machine without opencode, however well signed in it is', () => {
    const login = auth({ anthropic: { type: 'oauth' } })

    expect(opencodeCredential({}, login, () => false)).toBeNull()
  })

  it('reads the login out of the XDG data folder, wherever the boss keeps that', () => {
    expect(opencodeDataDir({ HOME: onDisk('/Users/boss') })).toBe(
      join(onDisk('/Users/boss'), '.local', 'share', 'opencode'),
    )
    expect(opencodeDataDir({ HOME: onDisk('/Users/boss'), XDG_DATA_HOME: '/data' })).toBe(join('/data', 'opencode'))
  })
})
