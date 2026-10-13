import { describe, expect, it } from 'vitest'
import type { SandboxPlan } from '../../shared/sandbox'
import type { PtySession, PtySpawnOptions } from './pty'
import { addedEnv, sandboxSpawnPty } from './sandbox-runtime'
import { wslSpawnPty } from './wsl-runtime'

/**
 * The line a jailed Session is really started with, on each of the three machines (T260).
 *
 * None of this was ever executed — ai-jail was not installed on the machine it was written on, and
 * TinyCorp never installs it (`docs/sandbox.md`). So the test is the claim: these are the argv
 * ai-jail's own documentation describes, and the WSL case is the one that would be wrong in a way
 * nobody would notice, because a jail that ran *outside* the distro would still start a process.
 */

const NOTHING: PtySession = {
  write: () => {},
  onData: () => () => {},
  onExit: () => () => {},
  kill: () => {},
  resize: () => {},
}

/** Records what really reached the PTY. */
function recorder() {
  const spawned: { file: string; args: string[]; options: PtySpawnOptions }[] = []
  return {
    spawned,
    spawn: (file: string, args: string[], options: PtySpawnOptions) => {
      spawned.push({ file, args, options })
      return NOTHING
    },
  }
}

const PLAN: SandboxPlan = { readOnly: ['/data/sessions'], readWrite: ['/data/rtk'], env: ['TINYCORP_HOOK_TOKEN'] }

const options = (cwd: string): PtySpawnOptions => ({ cwd, env: { TINYCORP_HOOK_TOKEN: 'tok' }, cols: 80, rows: 24 })

const JAIL = [
  '--agent-state',
  '--worktree',
  '--network',
  '--ro-map',
  '/data/sessions',
  '--rw-map',
  '/data/rtk',
  '--env',
  'TINYCORP_HOOK_TOKEN',
]

describe('a Session started inside ai-jail', () => {
  it('runs the Provider’s CLI through ai-jail on a Mac', () => {
    const pty = recorder()
    sandboxSpawnPty(pty.spawn, () => PLAN)('claude', ['--resume', 'abc'], options('/work/acme'))

    expect(pty.spawned[0]!.file).toBe('ai-jail')
    expect(pty.spawned[0]!.args).toEqual([...JAIL, '--', 'claude', '--resume', 'abc'])
    // The worktree is the working directory, which ai-jail makes the project and writable — so it
    // is never a `--rw-map`, and the cwd has to arrive unchanged for that to be true.
    expect(pty.spawned[0]!.options.cwd).toBe('/work/acme')
  })

  it('is the same line on a Linux desktop, because the jail is the machine’s and not the OS’s', () => {
    const pty = recorder()
    sandboxSpawnPty(pty.spawn, () => PLAN)('codex', [], options('/home/b/work'))

    expect(pty.spawned[0]!.file).toBe('ai-jail')
    expect(pty.spawned[0]!.args).toEqual([...JAIL, '--', 'codex'])
  })

  /**
   * The one that matters. ai-jail does not run on Windows itself, so on a Windows the jail has to
   * be *inside* the distro: the `wsl.exe` line comes first and `ai-jail` is what it runs in there.
   * Composed the other way round the app would try to start an `ai-jail` Windows has never heard of.
   */
  it('runs inside the distro on a Windows, never around the wsl.exe that reaches it', () => {
    const pty = recorder()
    const inside = wslSpawnPty(pty.spawn, { distro: 'Arch', host: {} })
    sandboxSpawnPty(inside, () => PLAN)('claude', ['--resume', 'abc'], options('C:\\work\\acme'))

    const { file, args } = pty.spawned[0]!
    expect(file).toBe('wsl.exe')
    expect(args.slice(0, 2)).toEqual(['-d', 'Arch'])
    // `ai-jail` is the command the login shell execs, and the Provider's own command is after `--`.
    const jailed = ['ai-jail', ...JAIL, '--', 'claude', '--resume', 'abc']
    expect(args.slice(-jailed.length)).toEqual(jailed)
    // The cwd crossed as a path inside the distro, like every other argument.
    expect(args).toContain('--cd')
    expect(args[args.indexOf('--cd') + 1]).toBe('/mnt/c/work/acme')
  })

  it('is byte for byte today’s line when the add-on is off', () => {
    const pty = recorder()
    const where = options('/work/acme')
    sandboxSpawnPty(pty.spawn, () => null)('claude', ['--resume', 'abc'], where)

    expect(pty.spawned).toEqual([{ file: 'claude', args: ['--resume', 'abc'], options: where }])
  })

  it('asks for the plan at every spawn, so turning it off takes at the next Session', () => {
    const pty = recorder()
    let on = true
    const spawn = sandboxSpawnPty(pty.spawn, () => (on ? PLAN : null))

    spawn('claude', [], options('/work'))
    on = false
    spawn('claude', [], options('/work'))

    expect(pty.spawned.map((one) => one.file)).toEqual(['ai-jail', 'claude'])
  })
})

describe('what crosses into a jail whose environment is a minimal allowlist', () => {
  it('is what the app itself put on the Session, and nothing the machine already had', () => {
    const host = { PATH: '/usr/bin', HOME: '/home/b' }
    const env = { PATH: '/usr/bin', HOME: '/home/b', TINYCORP_HOOK_TOKEN: 'tok', RTK_DB_PATH: '/data/rtk/h.db' }

    expect(addedEnv(env, host)).toEqual(['RTK_DB_PATH', 'TINYCORP_HOOK_TOKEN'])
  })

  it('counts a variable the app changed, because the jail would otherwise carry the old one', () => {
    expect(addedEnv({ CLAUDE_CONFIG_DIR: '/data/a' }, { CLAUDE_CONFIG_DIR: '/home/b/.claude' })).toEqual([
      'CLAUDE_CONFIG_DIR',
    ])
  })
})
