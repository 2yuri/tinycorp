import { describe, expect, it } from 'vitest'
import { suggestedCompanyFolder } from '../../shared/platform/company-folder'
import { WINDOWS_RUNTIME } from '../../shared/platform/wsl'
import { RTK_DB_ENV, RTK_TELEMETRY_ENV } from '../../shared/rtk'
import type { PtySession, PtySpawnOptions, SpawnPty } from './pty'
import { toLinuxPath } from './wsl-path'
import {
  teamHomeFolder,
  WSL_COMMAND,
  WSL_LOGIN_SCRIPT,
  wslCommand,
  wslEnv,
  wslHomeFolders,
  wslRunCli,
  wslSpawnPty,
} from './wsl-runtime'

/**
 * How a Session is started inside a distro (T167): the argv, the environment that crosses, and the
 * command the boss is handed for their own terminal.
 */

describe('the command that starts a CLI inside a distro', () => {
  it('names the distro, the folder as the distro names it, and runs the CLI in a login shell', () => {
    expect(
      wslCommand({ distro: 'Ubuntu', cwd: 'C:\\work\\acme', command: 'claude', args: ['--resume', 'abc'] }),
    ).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/work/acme',
      '-e',
      'sh',
      '-lc',
      WSL_LOGIN_SCRIPT,
      'claude',
      '--resume',
      'abc',
    ])
  })

  it('translates a path in an argument, which is the file the CLI would otherwise not find', () => {
    const argv = wslCommand({
      distro: 'Ubuntu',
      cwd: null,
      command: 'claude',
      args: ['--mcp-config', 'C:\\Users\\b\\AppData\\TinyCorp\\mcp\\3f2.json', '--strict-mcp-config'],
    })
    expect(argv).toContain('/mnt/c/Users/b/AppData/TinyCorp/mcp/3f2.json')
    expect(argv).not.toContain('C:\\Users\\b\\AppData\\TinyCorp\\mcp\\3f2.json')
  })

  /**
   * The `PATH` the boss's own shell has in the distro, in front of the script (T258). Without it the
   * Session starts under a login `sh`'s path, which on Arch has none of `~/.local/bin`, nvm or bun —
   * so the lookup could find a `claude` the Session then could not run.
   */
  it('starts the CLI under the PATH the lookup found it on', () => {
    const argv = wslCommand({
      distro: 'Arch',
      cwd: null,
      command: 'claude',
      args: ['--resume', 'abc'],
      path: '/home/b/.local/bin:/usr/bin',
    })
    expect(argv).toContain(`PATH='/home/b/.local/bin:/usr/bin'; ${WSL_LOGIN_SCRIPT}`)
    // Still `sh -lc`, so whatever else the profile puts in the environment is still there.
    expect(argv).toContain('-lc')
  })

  it('starts it exactly as it did before when no shell would say', () => {
    const argv = wslCommand({ distro: 'Arch', cwd: null, command: 'claude', args: [], path: null })
    expect(argv).toContain(WSL_LOGIN_SCRIPT)
    expect(argv.some((part) => part.includes('PATH='))).toBe(false)
  })

  it('leaves the prompt and the instructions exactly as the adapter wrote them', () => {
    const prompt = 'You are Ada. Each wake arrives shaped like:\\n\\n    [company]'
    expect(wslCommand({ distro: 'Ubuntu', cwd: null, command: 'claude', args: [prompt] })).toContain(prompt)
  })

  /**
   * A Company folder can be in the distro since T256, and a Session's cwd is the Company folder.
   * The Employee then works at `/home/b/…` natively rather than through `/mnt/c`, which is drvfs.
   */
  it('starts in the distro’s own path for a Company folder inside it', () => {
    const argv = wslCommand({
      distro: 'Arch',
      cwd: '\\\\wsl.localhost\\Arch\\home\\b\\TinyCorp\\Acme',
      command: 'claude',
      args: ['--add-dir', '\\\\wsl.localhost\\Arch\\home\\b\\TinyCorp\\Acme\\worktrees\\app\\t-1'],
    })

    expect(argv[argv.indexOf('--cd') + 1]).toBe('/home/b/TinyCorp/Acme')
    expect(argv).toContain('/home/b/TinyCorp/Acme/worktrees/app/t-1')
  })

  it('hands `--cd` a Windows path it cannot name, rather than start in the wrong folder', () => {
    // Another distro's filesystem has no name inside this one. `wsl.exe` takes either spelling and
    // fails visibly on one it cannot reach, which is the right kind of failure.
    const argv = wslCommand({
      distro: 'Ubuntu',
      cwd: '\\\\wsl.localhost\\Debian\\home\\b\\acme',
      command: 'claude',
      args: [],
    })
    expect(argv[argv.indexOf('--cd') + 1]).toBe('\\\\wsl.localhost\\Debian\\home\\b\\acme')
  })

  it('leaves the folder to the distro when there is none to name', () => {
    expect(wslCommand({ distro: 'Ubuntu', cwd: null, command: 'claude', args: [] })).not.toContain('--cd')
  })
})

describe('the environment that crosses', () => {
  const host = { PATH: 'C:\\Windows', HOME: 'C:\\Users\\b' }

  it('carries the app’s own variables through WSLENV', () => {
    const crossed = wslEnv({ ...host, TINYCORP_HOOK_TOKEN: 'tok' }, host)
    expect(crossed['WSLENV']).toBe('TINYCORP_HOOK_TOKEN')
    expect(crossed['TINYCORP_HOOK_TOKEN']).toBe('tok')
  })

  it('leaves Windows’s own variables behind: the distro has its own PATH and HOME', () => {
    const crossed = wslEnv({ ...host, TINYCORP_HOOK_TOKEN: 'tok' }, host)
    expect(crossed['WSLENV']).not.toContain('PATH')
    expect(crossed['WSLENV']).not.toContain('HOME')
  })

  it('carries a variable the app changed, not only one it added', () => {
    expect(wslEnv({ ...host, PATH: 'C:\\Windows;C:\\extra' }, host)['WSLENV']).toBe('PATH')
  })

  it('keeps a WSLENV that was already there', () => {
    const crossed = wslEnv({ ...host, WSLENV: 'ALREADY', TINYCORP_HOOK_TOKEN: 'tok' }, host)
    expect(crossed['WSLENV']!.split(':').sort()).toEqual(['ALREADY', 'TINYCORP_HOOK_TOKEN'])
  })

  it('adds nothing when the app added nothing', () => {
    expect(wslEnv({ ...host }, host)['WSLENV']).toBeUndefined()
  })

  it('asks WSL to translate a variable whose value is a Windows path (T179)', () => {
    // Without `/p`, RTK inside the distro is told to write its history to `C:\\…`, which it cannot
    // create — and this Company's savings stay at zero with nothing said about it.
    const crossed = wslEnv({ ...host, [RTK_DB_ENV]: 'C:\\Users\\b\\AppData\\rtk\\c-1\\history.db' }, host)

    expect(crossed['WSLENV']).toBe(`${RTK_DB_ENV}/p`)
  })

  it('leaves every other variable untranslated: they are tokens and flags, not paths', () => {
    const crossed = wslEnv({ ...host, TINYCORP_HOOK_TOKEN: 'tok', [RTK_TELEMETRY_ENV]: '1' }, host)

    expect(crossed['WSLENV']!.split(':').sort()).toEqual([RTK_TELEMETRY_ENV, 'TINYCORP_HOOK_TOKEN'])
  })

  /**
   * The config folder each product reads its sign-in and its per-Session config from (T257, T258).
   * They are not named anywhere — a value that is a Windows path is one whoever set it — and until
   * T258 only `RTK_DB_PATH` was, so an account TinyCorp had made under its own data folder arrived
   * in the distro as `C:\Users\…`: a folder no Linux process can open, so an added account in WSL
   * signed in nowhere the CLI could reach.
   */
  it('translates the config folder of every Provider, without naming one', () => {
    const crossed = wslEnv(
      {
        ...host,
        CLAUDE_CONFIG_DIR: 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\accounts\\work',
        CODEX_HOME: 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\accounts\\codex',
        OPENCODE_CONFIG: 'C:\\Users\\b\\AppData\\Roaming\\TinyCorp\\opencode\\3f2.json',
      },
      host,
    )

    expect(crossed['WSLENV']!.split(':').sort()).toEqual(['CLAUDE_CONFIG_DIR/p', 'CODEX_HOME/p', 'OPENCODE_CONFIG/p'])
  })

  /** A Company folder may live on a WSL share itself (T256), and that spelling translates too. */
  it('translates a UNC path into the distro', () => {
    const crossed = wslEnv({ ...host, TINYCORP_COMPANY: '\\\\wsl.localhost\\Arch\\home\\b\\acme' }, host)

    expect(crossed['WSLENV']).toBe('TINYCORP_COMPANY/p')
  })

  it('leaves a relative value and a list alone: there is no drive to translate', () => {
    const crossed = wslEnv({ ...host, TINYCORP_A: 'acme/work', TINYCORP_B: 'C:\\one;C:\\two' }, host)

    expect(crossed['WSLENV']!.split(':').sort()).toEqual(['TINYCORP_A', 'TINYCORP_B'])
  })
})

describe('a Session spawned through the runtime', () => {
  function record(): { calls: { file: string; args: string[]; options: PtySpawnOptions }[]; spawn: SpawnPty } {
    const calls: { file: string; args: string[]; options: PtySpawnOptions }[] = []
    const session = {} as PtySession
    return { calls, spawn: (file, args, options) => (calls.push({ file, args, options }), session) }
  }

  it('is a wsl.exe process on Windows with the CLI inside it', () => {
    const { calls, spawn } = record()
    const host = { PATH: 'C:\\Windows' }
    wslSpawnPty(spawn, { distro: 'Ubuntu', host })('claude', ['--resume', 'abc'], {
      cwd: 'C:\\work\\acme',
      env: { PATH: 'C:\\Windows', TINYCORP_HOOK_TOKEN: 'tok' },
      cols: 120,
      rows: 40,
    })
    expect(calls[0]!.file).toBe(WSL_COMMAND)
    expect(calls[0]!.args.slice(0, 4)).toEqual(['-d', 'Ubuntu', '--cd', '/mnt/c/work/acme'])
    // The terminal is still a Windows PTY, with the size the drawer asked for.
    expect(calls[0]!.options).toMatchObject({ cwd: 'C:\\work\\acme', cols: 120, rows: 40 })
    expect(calls[0]!.options.env['WSLENV']).toBe('TINYCORP_HOOK_TOKEN')
  })
})

describe('the preflight, for a CLI inside a distro', () => {
  it('asks the CLI that is going to run the Session, and not the one on Windows', async () => {
    const asked: { command: string; args: string[] }[] = []
    const run = wslRunCli(
      async (command, args) => {
        asked.push({ command, args: [...args] })
        return { kind: 'output', code: 0, output: '{}' }
      },
      { distro: 'Ubuntu', host: {} },
    )
    await run('claude', ['auth', 'status'])
    expect(asked[0]!.command).toBe(WSL_COMMAND)
    expect(asked[0]!.args.slice(-3)).toEqual(['claude', 'auth', 'status'])
  })
})

describe('the home folders inside a distro', () => {
  /*
   * The machine scan reads a distro's own skill folders and stores what it finds by the path this
   * Windows process reaches it at (T253). That path has to be the spelling T167 already knows how
   * to turn into the distro's own — a repo inside WSL is stored the same way — or a granted folder
   * is a path nothing on either side of the boundary can open.
   */
  it('spells a home the way the path layer reads it back as the distro’s own', () => {
    expect(toLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\b', { distro: 'Ubuntu' })).toBe('/home/b')
    expect(toLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\b\\.agents\\skills\\runbook', { distro: 'Ubuntu' })).toBe(
      '/home/b/.agents/skills/runbook',
    )
  })

  it('lists nothing where there is no distro to list, rather than throwing', () => {
    expect(wslHomeFolders('NoSuchDistro')).toEqual([])
  })
})

/**
 * Where the Create step suggests a Company folder (T256). The distro's homes are injected rather
 * than read off a `\\wsl.localhost` share, which only Windows serves at all.
 */
describe('the home a new Company is suggested under', () => {
  const homes = ['\\\\wsl.localhost\\Arch\\home\\ada', '\\\\wsl.localhost\\Arch\\home\\b']
  const windowsHome = 'C:\\Users\\b'

  it('is the distro’s own home when the team runs in WSL, because that is where the boss works', () => {
    const home = teamHomeFolder({
      teamDefault: { kind: 'wsl', distro: 'Arch' },
      windowsHome,
      account: 'b',
      homesIn: () => homes,
    })

    expect(home).toBe('\\\\wsl.localhost\\Arch\\home\\b')
    expect(suggestedCompanyFolder(home, 'Acme')).toBe('\\\\wsl.localhost\\Arch\\home\\b\\TinyCorp\\Acme')
  })

  it('is this PC’s home when the team runs on Windows, and on a Mac, where there is no default', () => {
    for (const teamDefault of [WINDOWS_RUNTIME, null]) {
      expect(teamHomeFolder({ teamDefault, windowsHome, account: 'b', homesIn: () => homes })).toBe(windowsHome)
    }
  })

  it('takes the first home when no account matches, and falls back to Windows when there is none', () => {
    const anyHome = { teamDefault: { kind: 'wsl', distro: 'Arch' } as const, windowsHome, account: 'nobody' }

    expect(teamHomeFolder({ ...anyHome, homesIn: () => homes })).toBe('\\\\wsl.localhost\\Arch\\home\\ada')
    expect(teamHomeFolder({ ...anyHome, homesIn: () => [] })).toBe(windowsHome)
  })
})
