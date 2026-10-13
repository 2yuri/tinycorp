import { describe, expect, it } from 'vitest'
import { providerEntry } from '../../../shared/domain/providers'
import type { ProviderRuntime } from '../../../shared/platform/wsl'
import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import { SIGN_IN_SEEN, type SignInState } from '../../../shared/usage/sign-in'
import { onDisk } from '../../core/testing'
import type { PtySession, PtySpawnOptions, SpawnPty } from '../../platform'
import type { ProviderAdapter, ProviderAdapters } from '../../providers'
import { createSignIns, loginFingerprint, POLL_MS, type SeenLogin, signInPty } from './sign-in'

/**
 * The sign-in modal's terminal (T263): the product's own login in a PTY inside the app, in the
 * place the Provider runs, and TinyCorp noticing when a login appears.
 */

const PERSONAL: ProviderAccount = {
  id: 'primary:claude',
  provider: 'claude',
  label: 'Personal',
  plan: null,
  email: null,
  configDir: onDisk('/home/b/.claude'),
  isDefault: true,
  primary: true,
}

const WORK: ProviderAccount = {
  ...PERSONAL,
  id: 'work',
  label: 'Work',
  configDir: onDisk('/app/accounts/claude/work'),
  isDefault: false,
  primary: false,
}

interface Spawned {
  file: string
  args: string[]
  options: PtySpawnOptions
  pty: FakePty
}

interface FakePty extends PtySession {
  output(data: string): void
  exit(exitCode: number): void
  killed: boolean
}

function fakePty(): FakePty {
  const data = new Set<(data: string) => void>()
  const exits = new Set<(exit: { exitCode: number }) => void>()
  const pty: FakePty = {
    killed: false,
    write: () => {},
    resize: () => {},
    kill: () => {
      pty.killed = true
    },
    onData: (listener) => {
      data.add(listener)
      return () => data.delete(listener)
    },
    onExit: (listener) => {
      exits.add(listener)
      return () => exits.delete(listener)
    },
    output: (text) => {
      for (const listener of data) listener(text)
    },
    exit: (exitCode) => {
      for (const listener of exits) listener({ exitCode })
    },
  }
  return pty
}

function recorder(): { spawn: SpawnPty; spawned: Spawned[] } {
  const spawned: Spawned[] = []
  return {
    spawned,
    spawn: (file, args, options) => {
      const pty = fakePty()
      spawned.push({ file, args, options, pty })
      return pty
    },
  }
}

function setup({
  runtime = null,
  login = null,
  folder = onDisk('/app/sign-in'),
  path = null,
  work = WORK,
}: {
  runtime?: ProviderRuntime | null
  login?: SeenLogin | null
  folder?: string
  path?: string | null
  work?: ProviderAccount
} = {}) {
  const { spawn, spawned } = recorder()
  const trusted: { configDir: string; folder: string }[] = []
  const adapter = {
    accounts: () => ({
      env: 'CLAUDE_CONFIG_DIR',
      defaultDir: PERSONAL.configDir,
      trustFolder: (configDir: string, where: string) => trusted.push({ configDir, folder: where }),
      email: () => 'boss@example.com',
    }),
    configDirEnv: (dir: string) => ({ CLAUDE_CONFIG_DIR: dir }),
  } as unknown as ProviderAdapter
  let current = login
  const states: SignInState[] = []
  const data: string[] = []
  const rechecked: string[] = []
  const polls: (() => void)[] = []
  const later: (() => void)[] = []
  const signIns = createSignIns({
    accounts: { list: () => [PERSONAL, work], of: () => [PERSONAL, work] },
    providers: { claude: adapter } as ProviderAdapters,
    runtimeOf: () => runtime,
    spawnIn: () => signInPty(runtime, spawn, { path, host: {} }),
    folder,
    makeDir: () => {},
    loginOf: () => async () => current,
    afterSignIn: (provider) => rechecked.push(provider),
    onData: (_id, text) => data.push(text),
    onState: (_id, state) => states.push(state),
    env: {},
    every: (run, ms) => {
      expect(ms).toBe(POLL_MS)
      polls.push(run)
      return () => polls.splice(polls.indexOf(run), 1)
    },
    after: (run) => {
      later.push(run)
      return () => {}
    },
    log: () => {},
  })
  return {
    signIns,
    spawned,
    trusted,
    states,
    data,
    rechecked,
    signInNow: (next: SeenLogin | null) => {
      current = next
    },
    poll: async () => {
      for (const run of [...polls]) run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    runLater: () => {
      for (const run of later.splice(0)) run()
    },
  }
}

const LOGIN: SeenLogin = { fingerprint: loginFingerprint('token-1'), plan: 'Max 20×' }

describe('the terminal a sign-in runs in', () => {
  /** macOS and Linux: the CLI itself, with the account's folder in its environment. */
  it('is the CLI itself where the Provider runs where the app does', async () => {
    const { signIns, spawned } = setup()
    const view = await signIns.start({ provider: 'claude', accountId: 'primary:claude' })

    expect(spawned[0]).toMatchObject({
      file: 'claude',
      args: ['/login'],
      options: { cwd: onDisk('/app/sign-in/claude') },
    })
    // The boss's own folder is the CLI's default: naming it would read another keychain item.
    expect(spawned[0]!.options.env).toEqual({})
    expect(view.sub).toBe('Personal')
  })

  it('points the CLI at an added account’s own folder, walking a fresh one through its first run', async () => {
    const { signIns, spawned } = setup()
    await signIns.start({ provider: 'claude', accountId: 'work' })

    expect(spawned[0]).toMatchObject({ file: 'claude', args: providerEntry('claude').auth.signIn.firstRunArgs })
    expect(spawned[0]!.options.env).toEqual({ CLAUDE_CONFIG_DIR: WORK.configDir })
  })

  /** Windows itself: the bare CLI, which node-pty's spawn resolves through `cli-command.ts`. */
  it('hands Windows the bare CLI, for cli-command to resolve its shim', async () => {
    const { signIns, spawned } = setup({ runtime: { kind: 'windows' }, login: LOGIN })
    const view = await signIns.start({ provider: 'claude', accountId: 'work' })

    expect(spawned[0]).toMatchObject({ file: 'claude', args: ['/login'] })
    expect(view.sub).toBe('Work · runs in Windows')
  })

  /** WSL: `wsl.exe` on the distro's own `PATH`, the account's folder translated on the way in. */
  it('runs inside the distro, with the account’s Windows folder crossing as a path', async () => {
    const folder = 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\sign-in'
    const work = { ...WORK, configDir: 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\accounts\\claude\\work' }
    const { signIns, spawned } = setup({
      work,
      runtime: { kind: 'wsl', distro: 'archlinux' },
      login: LOGIN,
      folder,
      path: '/home/b/.local/bin:/usr/bin',
    })
    const view = await signIns.start({ provider: 'claude', accountId: 'work' })

    expect(spawned[0]!.file).toBe('wsl.exe')
    expect(spawned[0]!.args).toEqual([
      '-d',
      'archlinux',
      '--cd',
      expect.stringMatching(/^\/mnt\/c\/Users\/b\/AppData\/Roaming\/TinyCorp\/sign-in[\\/]claude$/),
      '-e',
      'sh',
      '-lc',
      `PATH='/home/b/.local/bin:/usr/bin'; exec "$0" "$@"`,
      'claude',
      '/login',
    ])
    // `/p`: `wsl.exe` hands the distro `/mnt/c/Users/b/…`, the folder the CLI in there can open.
    expect(spawned[0]!.options.env).toEqual({ CLAUDE_CONFIG_DIR: work.configDir, WSLENV: 'CLAUDE_CONFIG_DIR/p' })
    expect(view.sub).toBe('Work · runs in WSL · archlinux')
  })
})

describe('the folder a sign-in runs in', () => {
  it('is marked trusted in an account folder TinyCorp made', async () => {
    const { signIns, trusted } = setup()
    await signIns.start({ provider: 'claude', accountId: 'work' })

    expect(trusted).toEqual([{ configDir: WORK.configDir, folder: onDisk('/app/sign-in/claude') }])
  })

  it('is never written into the boss’s own config', async () => {
    const { signIns, trusted } = setup()
    await signIns.start({ provider: 'claude', accountId: 'primary:claude' })

    expect(trusted).toEqual([])
  })
})

describe('noticing the sign-in', () => {
  it('moves to signed in when a login appears, names who, and closes the terminal after', async () => {
    const { signIns, spawned, states, data, rechecked, signInNow, poll, runLater } = setup()
    await signIns.start({ provider: 'claude', accountId: 'work' })

    await poll()
    expect(states).toEqual([])

    signInNow(LOGIN)
    await poll()
    expect(states).toEqual([{ phase: 'signed-in', who: 'boss@example.com · Max 20×' }])
    expect(data.join('')).toContain(SIGN_IN_SEEN)
    expect(rechecked).toEqual(['claude'])
    expect(spawned[0]!.pty.killed).toBe(false)

    runLater()
    expect(spawned[0]!.pty.killed).toBe(true)
  })

  it('takes a changed token as a new sign-in, and the same one as nothing', async () => {
    const { signIns, states, signInNow, poll } = setup({ login: LOGIN })
    await signIns.start({ provider: 'claude', accountId: 'primary:claude' })

    await poll()
    expect(states).toEqual([])

    signInNow({ fingerprint: loginFingerprint('token-2'), plan: 'Pro' })
    await poll()
    expect(states).toEqual([{ phase: 'signed-in', who: 'boss@example.com · Pro' }])
  })

  it('follows the steps the product’s own words say the boss is on', async () => {
    const { signIns, spawned, states } = setup()
    await signIns.start({ provider: 'claude', accountId: 'work' })

    spawned[0]!.pty.output('\x1b[1mSelect login\x1b[0m method:')
    expect(states.at(-1)).toEqual({ phase: 'waiting', step: 1 })
  })

  it('kills the terminal on Cancel and changes nothing', async () => {
    const { signIns, spawned, states, rechecked, signInNow, poll } = setup()
    const view = await signIns.start({ provider: 'claude', accountId: 'work' })

    signIns.cancel(view.id)
    signInNow(LOGIN)
    await poll()

    expect(spawned[0]!.pty.killed).toBe(true)
    expect(states).toEqual([])
    expect(rechecked).toEqual([])
  })

  it('says so when the terminal closes and no login appeared', async () => {
    const { signIns, spawned, states } = setup()
    await signIns.start({ provider: 'claude', accountId: 'work' })

    spawned[0]!.pty.exit(1)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(states.at(-1)).toMatchObject({ phase: 'ended' })
  })
})
