import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { createGitRunner } from './git-runner'
import { createRunners } from './run-in'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => ''),
  spawn: vi.fn(() => ({ stdout: null, stderr: null, stdin: null, on: vi.fn(), kill: vi.fn() })),
}))

const sync = vi.mocked(execFileSync)

/**
 * The one thing the ticket asked to be checked on a real ticket before anything else: `git worktree
 * add` writes an **absolute** `gitdir:` link, and an Employee inside a distro cannot follow a
 * `C:/…` or a `//wsl.localhost/…` one.
 *
 * There is no distro here, and there does not need to be one: the whole answer is *which git ran,
 * and with which arguments*, and that is a string. `wsl.exe` is the fake below, so what this pins is
 * that the distro's own git is what makes the worktree — and that the two paths it is given are Linux
 * paths, which is the only way the link it writes can be one.
 */
describe('a worktree of a repo inside a distro', () => {
  const repo = '\\\\wsl.localhost\\Arch\\home\\b\\acme'
  const worktree = '\\\\wsl.localhost\\Arch\\home\\b\\Acme\\worktrees\\ticket-tc-4'
  const ARCH = { kind: 'wsl', distro: 'Arch' } as const

  const ARCH_PATH = '/home/b/.local/bin:/usr/bin'

  function runner(team: typeof ARCH | typeof WINDOWS_RUNTIME) {
    return createGitRunner({
      runners: createRunners({ team: () => team, platform: 'win32', host: {}, loginPath: () => ARCH_PATH }),
    })
  }

  it('is added by the distro\u2019s git, with both paths in the distro\u2019s spelling', () => {
    sync.mockClear()
    runner(ARCH).text(repo, ['worktree', 'add', worktree, 'ticket-tc-4'])
    const [file, argv] = sync.mock.calls.at(-1) as [string, string[]]
    expect(file).toBe('wsl.exe')
    // Everything after the login script is the command the distro really runs.
    const command = argv.slice(argv.findIndex((part) => part.endsWith('exec "$0" "$@"')) + 1)
    expect(command).toEqual(['git', 'worktree', 'add', '/home/b/Acme/worktrees/ticket-tc-4', 'ticket-tc-4'])
    // And it runs *in* the repo, as the distro names it — so the `gitdir:` it writes is a Linux path.
    expect(argv.slice(0, 4)).toEqual(['-d', 'Arch', '--cd', '/home/b/acme'])
    // On the same PATH the Sessions get (T258): the git the Employee uses and the git the app uses
    // are the same installation, found the same way.
    expect(argv).toContain(`PATH='${ARCH_PATH}'; exec "$0" "$@"`)
  })

  it('comes back as the path the app\u2019s own database holds, not the one the distro printed', () => {
    sync.mockReturnValue('worktree /home/b/Acme/worktrees/ticket-tc-4\nHEAD abc\n' as never)
    const listed = runner(ARCH).tryText(repo, ['worktree', 'list', '--porcelain'], { mapPaths: true })
    expect(listed).toContain(worktree)
    sync.mockReturnValue('' as never)
  })

  it('stays with the Windows git while the team runs on Windows, exactly as T256 left it', () => {
    sync.mockClear()
    runner(WINDOWS_RUNTIME).text(repo, ['worktree', 'add', worktree, 'ticket-tc-4'])
    const [file, argv, options] = sync.mock.calls.at(-1) as [string, string[], { cwd?: string }]
    expect(file).toBe('git')
    expect(argv).toContain(worktree)
    expect(argv).toContain(`safe.directory=${repo}`)
    expect(options.cwd).toBe(repo)
  })
})
