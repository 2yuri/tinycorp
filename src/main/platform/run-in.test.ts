import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { mapPathsToHost, runIn, runtimeForPath } from './run-in'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => ''),
  spawn: vi.fn(() => ({})),
}))

const sync = vi.mocked(execFileSync)

/** What the last `execFileSync` was actually asked to start. */
function lastCall() {
  const call = sync.mock.calls.at(-1)
  if (!call) throw new Error('nothing was spawned')
  return { file: call[0] as string, args: call[1] as string[], options: (call[2] ?? {}) as Record<string, unknown> }
}

const UBUNTU = { kind: 'wsl', distro: 'Ubuntu' } as const

describe('runIn, on this machine', () => {
  it.each([['darwin'], ['linux'], ['win32']] as const)(
    'is today\u2019s execFile on %s when the team runs on this PC',
    (platform) => {
      sync.mockClear()
      runIn(WINDOWS_RUNTIME, { platform }).execFileSync('git', ['status', '--porcelain'], { cwd: '/repo' })
      const call = lastCall()
      expect(call.file).toBe('git')
      expect(call.args).toEqual(['status', '--porcelain'])
      expect(call.options['cwd']).toBe('/repo')
      expect(call.options['encoding']).toBe('utf8')
    },
  )

  it('adds no wsl.exe for a distro runtime off Windows, because there is no wsl.exe there', () => {
    sync.mockClear()
    runIn(UBUNTU, { platform: 'darwin' }).execFileSync('git', ['status'], { cwd: '/repo' })
    expect(lastCall().file).toBe('git')
  })

  it('leaves a path alone in both directions', () => {
    const runner = runIn(WINDOWS_RUNTIME, { platform: 'win32' })
    expect(runner.toRuntime('C:\\code\\acme')).toBe('C:\\code\\acme')
    expect(runner.toHost('C:\\code\\acme')).toBe('C:\\code\\acme')
  })

  it('resolves a Windows shim only when the caller asks, so git is untouched', () => {
    sync.mockClear()
    const runner = runIn(WINDOWS_RUNTIME, { platform: 'win32' })
    runner.execFileSync('git', ['status'])
    expect(lastCall().file).toBe('git')
    // `shim` goes through `cliInvocation`, which on a machine with no `gh` on PATH answers plainly —
    // the point here is that the flag is what decides, not the platform.
    runner.execFileSync('gh', ['pr', 'view'], { shim: true })
    expect(lastCall().args).toEqual(['pr', 'view'])
  })
})

describe('runIn, inside a distro', () => {
  const runner = runIn(UBUNTU, { platform: 'win32', host: { PATH: 'C:\\Windows' }, loginPath: () => null })

  it('is one wsl.exe line with the cwd translated and carried by --cd', () => {
    sync.mockClear()
    runner.execFileSync('git', ['status', '--porcelain'], { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\b\\acme' })
    const call = lastCall()
    expect(call.file).toBe('wsl.exe')
    expect(call.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/b/acme',
      '-e',
      'sh',
      '-lc',
      'exec "$0" "$@"',
      'git',
      'status',
      '--porcelain',
    ])
  })

  it('hands node no cwd of its own: a UNC working directory is the one Win32 refuses', () => {
    sync.mockClear()
    runner.execFileSync('git', ['status'], { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\b\\acme' })
    expect(lastCall().options['cwd']).toBeUndefined()
  })

  it('translates a Windows path that is a whole argument', () => {
    sync.mockClear()
    runner.execFileSync('git', ['worktree', 'add', 'C:\\work\\t-1', 'main'], { cwd: 'C:\\code\\acme' })
    const call = lastCall()
    expect(call.args).toContain('/mnt/c/work/t-1')
    expect(call.args).toContain('--cd')
    expect(call.args[3]).toBe('/mnt/c/code/acme')
  })

  it('names in WSLENV what the app itself added to the environment, and nothing Windows owns', () => {
    sync.mockClear()
    runner.execFileSync('git', ['status'], { env: { PATH: 'C:\\Windows', GIT_TERMINAL_PROMPT: '0' } })
    expect((lastCall().options['env'] as Record<string, string>)['WSLENV']).toBe('GIT_TERMINAL_PROMPT')
  })

  it('maps the paths in what came back only when the caller asked', () => {
    sync.mockReturnValue('/home/b/acme\n' as never)
    expect(runner.execFileSync('git', ['rev-parse', '--show-toplevel'], { mapPaths: true })).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\b\\acme\n',
    )
    expect(runner.execFileSync('git', ['rev-parse', '--show-toplevel'])).toBe('/home/b/acme\n')
    sync.mockReturnValue('' as never)
  })

  it('translates a path both ways', () => {
    expect(runner.toRuntime('D:\\code\\acme')).toBe('/mnt/d/code/acme')
    expect(runner.toHost('/home/b/acme')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\b\\acme')
    expect(runner.toHost('/mnt/d/code')).toBe('D:\\code')
  })
})

describe('mapPathsToHost', () => {
  const options = { distro: 'Ubuntu' }

  it('maps a whole line and a path after a keyword', () => {
    expect(mapPathsToHost('worktree /home/b/acme\nHEAD abc\n', options)).toBe(
      'worktree \\\\wsl.localhost\\Ubuntu\\home\\b\\acme\nHEAD abc\n',
    )
  })

  it('maps a mounted drive back to the drive the app already holds', () => {
    expect(mapPathsToHost('/mnt/d/code/acme', options)).toBe('D:\\code\\acme')
  })

  it('leaves what is not a path alone', () => {
    expect(mapPathsToHost('nothing here', options)).toBe('nothing here')
  })
})

describe('runtimeForPath', () => {
  it('answers this machine for every path there is while the team runs on Windows', () => {
    // Which is what keeps a Windows boss who has not chosen WSL, and every Mac and Linux desktop,
    // on exactly the behaviour they had — a Company folder on a WSL share included (T256).
    for (const path of ['\\\\wsl.localhost\\Arch\\home\\b\\acme', 'D:\\code\\acme', '/home/b/acme']) {
      expect(runtimeForPath(path, WINDOWS_RUNTIME)).toEqual(WINDOWS_RUNTIME)
      expect(runtimeForPath(path, null)).toEqual(WINDOWS_RUNTIME)
    }
  })

  it('reads a UNC path as the distro it names, even when the team runs in another one', () => {
    expect(runtimeForPath('\\\\wsl.localhost\\Debian\\home\\b\\acme', UBUNTU)).toEqual({
      kind: 'wsl',
      distro: 'Debian',
    })
    expect(runtimeForPath('\\\\wsl$\\Debian\\home\\b\\acme', UBUNTU)).toEqual({ kind: 'wsl', distro: 'Debian' })
  })

  it('reads a POSIX path as the team\u2019s distro, because that is where it came from', () => {
    expect(runtimeForPath('/home/b/acme', UBUNTU)).toEqual(UBUNTU)
  })

  it('reads a drive as Windows even when the team runs in a distro, because its worktree links are', () => {
    expect(runtimeForPath('D:\\code\\acme', UBUNTU)).toEqual(WINDOWS_RUNTIME)
  })
})

/**
 * The distro's own `PATH` in front of every command, not just every Session (T258, T259).
 *
 * T258 stopped looking for a CLI with a login `sh` and started asking the distro's own shell for its
 * `PATH`, because a distro that ships no `~/.profile` — Arch — keeps `~/.local/bin`, nvm, npm-global
 * and bun in `~/.zshrc`, where a login shell never looks. A Session then starts on the `PATH` the
 * lookup found the CLI on, which is the only way the two can agree.
 *
 * Everything this ticket moves into the distro needs the same `PATH` for the same reason: a `gh` or an
 * `rtk` in `~/.local/bin` is one the app would otherwise report installed and then fail to start.
 */
describe('the PATH a command runs under inside a distro', () => {
  const DISTRO_PATH = '/home/b/.local/bin:/usr/bin'

  it('is the one the boss\u2019s own shell has, in front of the login script', () => {
    sync.mockClear()
    runIn(UBUNTU, { platform: 'win32', host: {}, loginPath: () => DISTRO_PATH }).execFileSync('git', ['status'])
    expect(lastCall().args).toContain(`PATH='${DISTRO_PATH}'; exec "$0" "$@"`)
  })

  it('is asked per call, never when the runner is made, because a runner is made at module load', () => {
    let asked = 0
    const runner = runIn(UBUNTU, { platform: 'win32', host: {}, loginPath: () => (asked++, DISTRO_PATH) })
    expect(asked).toBe(0)
    runner.execFileSync('git', ['status'])
    expect(asked).toBe(1)
  })

  it('falls back to a plain login sh when the distro\u2019s shell would not answer', () => {
    // Which is what every WSL Session had before T258, and what an `~/.zshrc` that hangs still gets.
    sync.mockClear()
    runIn(UBUNTU, { platform: 'win32', host: {}, loginPath: () => null }).execFileSync('git', ['status'])
    expect(lastCall().args).toContain('exec "$0" "$@"')
  })
})
