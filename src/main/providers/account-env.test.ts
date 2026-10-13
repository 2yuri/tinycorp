import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_CONFIG_DIR_ENV, createClaudeAdapter } from './claude/adapter'
import { accountEnv, configDirVars, type ProviderAdapter } from './provider-adapter'

const claude = createClaudeAdapter({
  hookUrl: 'http://127.0.0.1/hook',
  dataDir: '/tmp/tc',
  installed: () => true,
}) as ProviderAdapter

describe('the config directory an account runs in', () => {
  it('sets nothing for the directory the CLI uses on its own, which is where the boss is already signed in', () => {
    // Claude Code on macOS reads a different keychain entry once CLAUDE_CONFIG_DIR is set at all.
    expect(configDirVars(claude, join(homedir(), '.claude'))).toEqual({})
    expect(configDirVars(claude, join(homedir(), '.claude') + '/')).toEqual({})
    expect(accountEnv(claude, { id: 'default', configDir: join(homedir(), '.claude') })).toEqual({})
  })

  it('points a second account at its own directory', () => {
    const dir = join(homedir(), '.tinycorp', 'accounts', 'work')
    expect(configDirVars(claude, dir)).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: dir })
    expect(accountEnv(claude, { id: 'work', configDir: dir })).toEqual({ [CLAUDE_CONFIG_DIR_ENV]: dir })
  })

  it('sets nothing when no account is named', () => {
    expect(accountEnv(claude, undefined)).toEqual({})
  })
})
