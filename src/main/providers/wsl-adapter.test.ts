import { describe, expect, it } from 'vitest'
import type { Employee } from '../../shared/domain/staff'
import { type PtySession, WSL_COMMAND, WSL_LOGIN_SCRIPT } from '../platform'
import type { ProviderAdapter } from './provider-adapter'
import { wslAdapter } from './wsl-adapter'

/**
 * What wrapping an adapter for a distro changes (T167, T258): the RTK its Sessions are spawned with,
 * and the two commands that are run in a terminal rather than by the app — the handoff and the
 * product's own login. The argv, the paths and the environment that crosses are the machine's, and
 * are tested in `main/platform/wsl-runtime.test.ts`.
 */

const UBUNTU = { distro: 'Ubuntu' }

describe('the RTK a Session inside a distro is spawned with (T179)', () => {
  const rtk = { path: 'C:\\Users\\b\\.local\\bin\\rtk.exe', dbPath: 'C:\\data\\history.db', ping: false }

  /** An adapter that records the request it was spawned with, and nothing else. */
  function recorder(): { spawned: (typeof rtk | null)[]; adapter: ProviderAdapter } {
    const spawned: (typeof rtk | null)[] = []
    const adapter = {
      spawn: (request: { rtk?: typeof rtk }) => {
        spawned.push(request.rtk ?? null)
        return null as unknown as PtySession
      },
    } as unknown as ProviderAdapter
    return { spawned, adapter }
  }

  const request = { rtk } as unknown as Parameters<ProviderAdapter['spawn']>[0]

  it('is the one inside the distro, not the one on the Windows PATH', () => {
    const { spawned, adapter } = recorder()

    wslAdapter(adapter, { ...UBUNTU, rtkPath: '/home/boss/.local/bin/rtk' }).spawn(request)

    expect(spawned[0]?.path).toBe('/home/boss/.local/bin/rtk')
    expect(spawned[0]?.dbPath, 'the history file is still the Company’s; WSLENV translates it').toBe(rtk.dbPath)
  })

  it('is none at all for a distro that has no RTK inside it', () => {
    const { spawned, adapter } = recorder()

    wslAdapter(adapter, { ...UBUNTU, rtkPath: null }).spawn(request)

    expect(spawned[0], 'a hook naming a program the distro does not have rewrites nothing, silently').toBeNull()
  })

  it('is left alone where nothing has looked inside a distro', () => {
    const { spawned, adapter } = recorder()

    wslAdapter(adapter, UBUNTU).spawn(request)

    expect(spawned[0]).toEqual(rtk)
  })
})

describe('the command the boss types in their own terminal', () => {
  const ada = { id: 'e1', name: 'Ada', provider: 'claude' } as Employee

  it('opens the Session where the Session is (T164)', () => {
    const inner = {
      handoffCommand: () => ['claude', '--resume', 'abc', '--dangerously-skip-permissions'],
    } as unknown as ProviderAdapter
    expect(wslAdapter(inner, UBUNTU).handoffCommand!(ada, 'abc')).toEqual([
      WSL_COMMAND,
      '-d',
      'Ubuntu',
      '-e',
      'sh',
      '-lc',
      WSL_LOGIN_SCRIPT,
      'claude',
      '--resume',
      'abc',
      '--dangerously-skip-permissions',
    ])
  })

  it('still says nothing for a Provider that cannot hand a Session over', () => {
    const inner = { handoffCommand: () => null } as unknown as ProviderAdapter
    expect(wslAdapter(inner, UBUNTU).handoffCommand!(ada, 'abc')).toBeNull()
  })

  it('leaves an adapter that has no handoff without one', () => {
    const inner = {} as ProviderAdapter
    expect(wslAdapter(inner, UBUNTU).handoffCommand).toBeUndefined()
  })
})

/**
 * An account's config folder, as the adapter in a distro hands it on (T257, T263). The login itself
 * is no longer wrapped here: the sign-in runs in a PTY the runtime already puts in the distro.
 */
describe('an account’s config folder', () => {
  const support = { env: 'CLAUDE_CONFIG_DIR', defaultDir: '~/.claude', email: () => 'boss@example.com' }

  it('names no address for the default folder, whose login is in the distro’s own home', () => {
    const inner = { accounts: () => support } as unknown as ProviderAdapter
    const accounts = wslAdapter(inner, UBUNTU).accounts!()
    expect(accounts.email!('~/.claude')).toBeNull()
    expect(accounts.email!('C:\\Users\\b\\AppData\\TinyCorp\\accounts\\work')).toBe('boss@example.com')
  })

  /**
   * The account's folder is on this PC, and the login writes the sign-in into it — so the distro has
   * to be able to open it. Without this, an added account in WSL signed in to a `C:\Users\…` that no
   * Linux process can reach, and the card said signed out for ever (T257).
   */
  it('asks WSL to translate the account’s own folder on the way in', () => {
    const inner = {
      accounts: () => support,
      configDirEnv: (dir: string) => ({ CLAUDE_CONFIG_DIR: dir }),
    } as unknown as ProviderAdapter
    const env = wslAdapter(inner, UBUNTU).configDirEnv!('C:\\Users\\b\\AppData\\TinyCorp\\accounts\\work')
    expect(env['WSLENV']).toBe('CLAUDE_CONFIG_DIR/p')
  })

  it('leaves the rest of what the product said about its accounts alone', () => {
    const inner = { accounts: () => support } as unknown as ProviderAdapter
    expect(wslAdapter(inner, UBUNTU).accounts!()).toMatchObject({ env: support.env, defaultDir: support.defaultDir })
  })

  it('says nothing for a Provider that holds one sign-in', () => {
    expect(wslAdapter({} as ProviderAdapter, UBUNTU).accounts).toBeUndefined()
  })
})
