import { describe, expect, it, vi } from 'vitest'
import {
  cachedWslLoginPath,
  decodeWsl,
  forgetWsl,
  probeWsl,
  WSL_PATH_SCRIPT,
  type WslOutcome,
  type WslRunner,
  wslDistros,
  wslLoginPath,
} from './wsl'

/**
 * Finding WSL, and finding a CLI inside it (T167) — against a fake `wsl.exe`, so nothing here
 * starts a distro or needs a Windows to run on.
 *
 * The fixtures are UTF-16LE with a BOM, because that is what `wsl.exe -l` really writes and
 * reading it as UTF-8 is the bug this suite exists for: every distro name comes back with a NUL
 * between its letters and every comparison against it fails silently.
 */

/** A `wsl.exe` answer in the encoding the real one uses. */
function utf16(text: string): WslOutcome {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  return { kind: 'output', code: 0, output: decodeWsl(bytes) }
}

/** A runner that answers by the first argument it is given, and records what it was asked. */
function fakeWsl(answers: Partial<Record<string, WslOutcome>>, asked: string[][] = []): WslRunner {
  return (args) => {
    asked.push([...args])
    const key = args.includes('-l') ? args.join(' ') : 'sh'
    return answers[key] ?? { kind: 'failed', output: '' }
  }
}

const LIST = '-l -v'

describe('the distros this Windows has', () => {
  it('reads the UTF-16 listing, the default one first, with what is running', () => {
    const run = fakeWsl({
      [LIST]: utf16('  NAME      STATE     VERSION\r\n  Debian    Stopped   2\r\n* Ubuntu    Running   2\r\n'),
    })
    expect(wslDistros(run)).toEqual([
      { name: 'Ubuntu', running: true, default: true },
      { name: 'Debian', running: false, default: false },
    ])
  })

  it('skips the header whatever language it is in, by its shape', () => {
    // The last column of a distro is its WSL version, a number. A header's is a word.
    const run = fakeWsl({ [LIST]: utf16('  NOME      STATO     VERSIONE\r\n* Ubuntu    In esecuzione   2\r\n') })
    // `In esecuzione` is two words, so the row does not parse as one — and a state this app does
    // not recognise reads as stopped, never as running.
    expect(wslDistros(run)).toEqual([])
  })

  it('falls back to the quiet listing when the verbose one says nothing', () => {
    const run = fakeWsl({ [LIST]: { kind: 'failed', output: '' }, '-l -q': utf16('Ubuntu\r\nDebian\r\n') })
    expect(wslDistros(run)).toEqual([
      { name: 'Ubuntu', running: false, default: true },
      { name: 'Debian', running: false, default: false },
    ])
  })

  it('is nothing at all on a machine with no WSL', () => {
    expect(wslDistros(() => ({ kind: 'missing' }))).toEqual([])
  })

  it('is nothing when `wsl.exe` hangs, rather than a wait for every Provider', () => {
    expect(wslDistros(() => ({ kind: 'timeout' }))).toEqual([])
  })
})

describe('looking for a CLI inside a distro', () => {
  const ubuntu = { name: 'Ubuntu', running: true, default: true }

  it('asks a login shell when nobody has read the distro’s own PATH', () => {
    const asked: string[][] = []
    const run = fakeWsl({ sh: utf16('/home/b/.local/bin/claude\n') }, asked)
    expect(probeWsl(run, ubuntu, 'claude').path).toBe('/home/b/.local/bin/claude')
    expect(asked[0]).toEqual(['-d', 'Ubuntu', '-e', 'sh', '-lc', "command -v 'claude'"])
  })

  /**
   * The bug the boss hit (T258): on Arch, `sh -lc` reads `/etc/profile` and a `~/.profile` that is
   * not there, so `~/.local/bin` — where Claude Code's own installer puts itself — is invisible to
   * it, and TinyCorp reported a CLI missing that their own terminal runs every day.
   */
  it('looks on the PATH the boss’s own shell has, which is where ~/.local/bin is', () => {
    const asked: string[][] = []
    const run = fakeWsl({ sh: utf16('/home/b/.local/bin/claude\n') }, asked)
    const probe = probeWsl(run, ubuntu, 'claude', '/home/b/.local/bin:/usr/bin')
    expect(probe.path).toBe('/home/b/.local/bin/claude')
    expect(asked[0]!.at(-1)).toBe("PATH='/home/b/.local/bin:/usr/bin'; command -v 'claude'")
  })

  /**
   * WSL puts the Windows `PATH` on every distro's, so `command -v claude` in Arch answers with the
   * *Windows* npm shim. Running it would start the Windows installation, with the Windows login,
   * from inside Linux — so it is not a CLI in this distro, and saying it was is how a boss who chose
   * WSL got Windows Employees.
   */
  it('ignores a Windows shim reached through /mnt, which is not this distro’s CLI', () => {
    const run = fakeWsl({ sh: utf16('/mnt/c/Users/b/AppData/Roaming/npm/claude\n') })
    expect(probeWsl(run, ubuntu, 'claude')).toMatchObject({ path: null, unreachable: false })
  })

  it('takes the distro’s own hit when both are printed', () => {
    const run = fakeWsl({ sh: utf16('/mnt/c/Users/b/npm/claude\n/home/b/.local/bin/claude\n') })
    expect(probeWsl(run, ubuntu, 'claude').path).toBe('/home/b/.local/bin/claude')
  })

  it('reports a CLI that is not there without calling the distro unreachable', () => {
    const run = fakeWsl({ sh: { kind: 'output', code: 1, output: '' } })
    expect(probeWsl(run, ubuntu, 'claude')).toEqual({
      distro: 'Ubuntu',
      path: null,
      unreachable: false,
      started: false,
    })
  })

  it('says a stopped distro was woken, so the row can say so too', () => {
    const asleep = { name: 'Ubuntu', running: false, default: true }
    const run = fakeWsl({ sh: utf16('/usr/bin/codex\n') })
    expect(probeWsl(run, asleep, 'codex')).toMatchObject({ path: '/usr/bin/codex', started: true })
  })

  it('a probe that timed out is unreachable, and is not an answer about the CLI', () => {
    const probe = probeWsl(() => ({ kind: 'timeout' }), ubuntu, 'claude')
    expect(probe).toMatchObject({ path: null, unreachable: true })
  })

  it('a distro `wsl.exe` cannot reach is unreachable, not a CLI that is missing', () => {
    const run = fakeWsl({ sh: { kind: 'failed', output: 'There are no installed distributions.' } })
    expect(probeWsl(run, ubuntu, 'claude')).toMatchObject({ path: null, unreachable: true })
  })
})

describe('what `wsl.exe` wrote', () => {
  it('decodes UTF-16 with a BOM, which is its own messages', () => {
    expect(decodeWsl(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ubuntu\n', 'utf16le')]))).toBe('Ubuntu\n')
  })

  it('decodes UTF-16 without one, which older builds write', () => {
    expect(decodeWsl(Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le'))).toBe('Ubuntu\r\nDebian\r\n')
  })

  it('leaves UTF-8 alone, which is what a program inside the distro wrote', () => {
    expect(decodeWsl(Buffer.from('/home/b/.local/bin/claude\n', 'utf8'))).toBe('/home/b/.local/bin/claude\n')
  })

  it('is empty for nothing at all', () => {
    expect(decodeWsl(undefined)).toBe('')
  })
})

/**
 * Reading the distro's `PATH` the way the boss's own shell builds it (T258) — the same question
 * `readLoginShellPath` asks on a Mac and on a Linux desktop, asked inside a distro.
 */
describe('the PATH inside a distro', () => {
  it('is read through the boss’s own shell, interactive and login', () => {
    const asked: string[][] = []
    const run = fakeWsl(
      {
        sh: {
          kind: 'output',
          code: 0,
          output: '__TINYCORP_WSL_PATH__/home/b/.local/bin:/usr/bin__TINYCORP_WSL_PATH__',
        },
      },
      asked,
    )
    expect(wslLoginPath(run, 'Arch')).toBe('/home/b/.local/bin:/usr/bin')
    expect(asked[0]).toEqual(['-d', 'Arch', '-e', 'sh', '-c', WSL_PATH_SCRIPT])
    // `-ilc`, because `~/.zshrc` is the only place an Arch boss's PATH is written.
    expect(WSL_PATH_SCRIPT).toContain('-ilc')
  })

  it('is taken from the marks, not from a chatty rc file’s own output', () => {
    const noisy = 'nvm: version 22 in use\n__TINYCORP_WSL_PATH__/home/b/.bun/bin:/usr/bin__TINYCORP_WSL_PATH__'
    const run = fakeWsl({ sh: { kind: 'output', code: 0, output: noisy } })
    expect(wslLoginPath(run, 'Arch')).toBe('/home/b/.bun/bin:/usr/bin')
  })

  it('is nothing when the shell printed no marks, so the caller falls back', () => {
    const run = fakeWsl({ sh: { kind: 'output', code: 0, output: 'welcome to Arch\n' } })
    expect(wslLoginPath(run, 'Arch')).toBeNull()
  })

  /** An `~/.zshrc` that waits for a keystroke must cost one timeout, not a Session start. */
  it('times out into today’s login sh, once, and says so in the log', () => {
    forgetWsl()
    const log = vi.fn()
    const run = vi.fn<WslRunner>(() => ({ kind: 'timeout' }))
    expect(cachedWslLoginPath(run, 'Arch', log)).toBeNull()
    expect(cachedWslLoginPath(run, 'Arch', log)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('Arch')
    // And the probe then asks exactly what it asked before this existed.
    const asked: string[][] = []
    const found = fakeWsl({ sh: utf16('/usr/bin/claude\n') }, asked)
    expect(probeWsl(found, { name: 'Arch', running: true, default: true }, 'claude', null).path).toBe('/usr/bin/claude')
    expect(asked[0]!.at(-1)).toBe("command -v 'claude'")
  })

  it('is read once per distro and remembered for the run', () => {
    forgetWsl()
    const marked = '__TINYCORP_WSL_PATH__/usr/bin__TINYCORP_WSL_PATH__'
    const run = vi.fn<WslRunner>(() => ({ kind: 'output', code: 0, output: marked }))
    expect(cachedWslLoginPath(run, 'Arch')).toBe('/usr/bin')
    expect(cachedWslLoginPath(run, 'Arch')).toBe('/usr/bin')
    expect(cachedWslLoginPath(run, 'Ubuntu')).toBe('/usr/bin')
    expect(run).toHaveBeenCalledTimes(2)
  })
})
