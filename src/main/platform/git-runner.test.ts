import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { createGitRunner } from './git-runner'
import { createRunners } from './run-in'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => ''),
  spawn: vi.fn(() => ({})),
}))

const sync = vi.mocked(execFileSync)

/** The argv the last git call really got, whichever runtime it went to. */
function lastArgv(): string[] {
  const call = sync.mock.calls.at(-1)
  if (!call) throw new Error('no git ran')
  return call[1] as string[]
}

const ARCH = { kind: 'wsl', distro: 'Arch' } as const
const UNC = '\\\\wsl.localhost\\Arch\\home\\b\\Acme'

/** A runner as a Windows boss whose team runs in `Arch` would get one. */
const ARCH_PATH = '/home/b/.local/bin:/usr/bin'

function onWindows(team: typeof ARCH | typeof WINDOWS_RUNTIME | null) {
  return createGitRunner({
    runners: createRunners({ team: () => team, platform: 'win32', host: {}, loginPath: () => ARCH_PATH }),
  })
}

describe('which git a repo gets', () => {
  it('gives a repo inside a distro that distro\u2019s own git once the team runs in WSL', () => {
    expect(onWindows(ARCH).runtimeFor(UNC)).toEqual(ARCH)
    expect(onWindows({ kind: 'wsl', distro: 'Ubuntu' }).runtimeFor(UNC)).toEqual(ARCH)
  })

  it('leaves a repo inside a distro to the Windows git while the team runs on Windows', () => {
    // T256 made that work, with `safe.directory`; a distro with no `git` in it must stay a machine
    // the app works on, so a path alone never moves a command into one.
    expect(onWindows(WINDOWS_RUNTIME).runtimeFor(UNC)).toEqual(WINDOWS_RUNTIME)
  })

  it('gives a repo on a drive the Windows git, even when the team runs in a distro', () => {
    expect(onWindows(ARCH).runtimeFor('D:\\code\\acme')).toEqual(WINDOWS_RUNTIME)
  })

  it('runs the distro\u2019s git through wsl.exe, in the folder the distro knows it by', () => {
    sync.mockClear()
    onWindows(ARCH).tryText(UNC, ['rev-parse', 'HEAD'])
    expect(sync.mock.calls.at(-1)?.[0]).toBe('wsl.exe')
    expect(lastArgv().slice(0, 4)).toEqual(['-d', 'Arch', '--cd', '/home/b/Acme'])
  })

  it('runs it on the same PATH the Sessions get, which is where T258 found the CLI', () => {
    sync.mockClear()
    onWindows(ARCH).tryText(UNC, ['rev-parse', 'HEAD'])
    expect(lastArgv()).toContain(`PATH='${ARCH_PATH}'; exec "$0" "$@"`)
  })
})

describe('the settings in front of every git command', () => {
  it('carries core.longpaths on a drive, and nothing about ownership', () => {
    const settings = onWindows(WINDOWS_RUNTIME).settings('D:\\code\\acme')
    expect(settings).toEqual(['-c', 'core.longpaths=true'])
  })

  it('names a repo inside a distro as safe in both spellings, when Windows\u2019s git is the one asking', () => {
    // `safe.directory` is multi-valued, so repeating `-c` adds rather than replaces — and git
    // computes the repo's path as a UNC with forward slashes while this process holds the
    // backslashed one, so only naming both makes the repo openable at all (T256).
    const settings = onWindows(WINDOWS_RUNTIME).settings(UNC)
    expect(settings).toContain(`safe.directory=${UNC}`)
    expect(settings).toContain('safe.directory=//wsl.localhost/Arch/home/b/Acme')
    // Never the blanket form, which would turn the protection off for every repo on the machine.
    expect(settings).not.toContain('safe.directory=*')
  })

  it('carries none of it when the distro\u2019s own git is asking, because there it is the owner', () => {
    expect(onWindows(ARCH).settings(UNC)).toEqual([])
  })
})

describe('what git printed', () => {
  it('comes back in the spelling the app\u2019s own database holds', () => {
    sync.mockReturnValue('/home/b/Acme\n' as never)
    expect(onWindows(ARCH).tryText(UNC, ['rev-parse', '--show-toplevel'], { mapPaths: true })).toBe(
      '\\\\wsl.localhost\\Arch\\home\\b\\Acme\n',
    )
    sync.mockReturnValue('' as never)
  })

  it('is left exactly as it came when the caller did not ask, because a patch is somebody\u2019s code', () => {
    sync.mockReturnValue('+import x from "/usr/share/x"\n' as never)
    expect(onWindows(ARCH).tryText(UNC, ['diff'])).toBe('+import x from "/usr/share/x"\n')
    sync.mockReturnValue('' as never)
  })
})

describe('a failure', () => {
  it('keeps what git printed, because a merge says CONFLICT on stdout', () => {
    sync.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit 1'), { stdout: 'CONFLICT (content): x\n', stderr: '' })
    })
    expect(() => onWindows(null).text('D:\\code\\acme', ['merge', 'topic'])).toThrow(/git merge failed/)
    sync.mockImplementationOnce(() => {
      throw Object.assign(new Error('exit 1'), { stdout: 'CONFLICT (content): x\n', stderr: '' })
    })
    try {
      onWindows(null).text('D:\\code\\acme', ['merge', 'topic'])
    } catch (error) {
      expect((error as { stdout: string }).stdout).toContain('CONFLICT')
    }
  })
})
