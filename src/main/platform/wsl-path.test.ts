import { describe, expect, it } from 'vitest'
import { toLinuxPath, toWindowsPath, translatePaths, untranslatePaths, wslPathVia, wslUncDistro } from './wsl-path'

/**
 * Both directions of the translation a Session in WSL depends on (T167).
 *
 * Every string here is written out in full rather than built with `join`: the whole point is what
 * a *Windows* path looks like, and a fixture that asked the platform would say something else on
 * the Mac this suite also runs on.
 */

const UBUNTU = { distro: 'Ubuntu' }

describe('a Windows path, as the distro names it', () => {
  it('puts a drive under the automount root, lower-cased', () => {
    expect(toLinuxPath('C:\\Users\\b\\x', UBUNTU)).toBe('/mnt/c/Users/b/x')
    expect(toLinuxPath('D:\\code', UBUNTU)).toBe('/mnt/d/code')
  })

  it('keeps the spaces in a folder somebody named with spaces', () => {
    expect(toLinuxPath('C:\\Users\\Ada Lorne\\My Repos\\acme', UBUNTU)).toBe('/mnt/c/Users/Ada Lorne/My Repos/acme')
  })

  it('takes a forward-slashed Windows path, which plenty of tools print', () => {
    expect(toLinuxPath('c:/Users/b/x', UBUNTU)).toBe('/mnt/c/Users/b/x')
  })

  it('is the drive itself when nothing follows it', () => {
    expect(toLinuxPath('C:\\', UBUNTU)).toBe('/mnt/c')
    expect(toLinuxPath('C:', UBUNTU)).toBe('/mnt/c')
  })

  it('reads both UNC spellings of the distro’s own filesystem', () => {
    expect(toLinuxPath('\\\\wsl$\\Ubuntu\\home\\b\\x', UBUNTU)).toBe('/home/b/x')
    expect(toLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\b\\x', UBUNTU)).toBe('/home/b/x')
  })

  it('refuses a UNC path into another distro, rather than open the wrong file', () => {
    // `\\wsl.localhost\Debian\home\b` is Debian's home. Inside Ubuntu it is somebody else's.
    expect(toLinuxPath('\\\\wsl.localhost\\Debian\\home\\b\\x', UBUNTU)).toBeNull()
  })

  it('honours an automount root a wsl.conf moved', () => {
    expect(toLinuxPath('C:\\x', { distro: 'Ubuntu', automountRoot: '/windows' })).toBe('/windows/c/x')
  })

  it('hands back a path that is already the distro’s', () => {
    expect(toLinuxPath('/home/b/x', UBUNTU)).toBe('/home/b/x')
  })

  it('says nothing about a relative path or an empty one', () => {
    expect(toLinuxPath('src/index.ts', UBUNTU)).toBeNull()
    expect(toLinuxPath('', UBUNTU)).toBeNull()
  })
})

describe('a distro path, as Windows names it', () => {
  it('gives a mounted drive back as that drive', () => {
    expect(toWindowsPath('/mnt/c/Users/b/x', UBUNTU)).toBe('C:\\Users\\b\\x')
    expect(toWindowsPath('/mnt/d/code/My Repos', UBUNTU)).toBe('D:\\code\\My Repos')
  })

  it('reaches the distro’s own filesystem over UNC', () => {
    expect(toWindowsPath('/home/b/x', UBUNTU)).toBe('\\\\wsl.localhost\\Ubuntu\\home\\b\\x')
  })

  it('round-trips a drive path', () => {
    const windows = 'C:\\Users\\Ada Lorne\\acme'
    expect(toWindowsPath(toLinuxPath(windows, UBUNTU)!, UBUNTU)).toBe(windows)
  })

  it('says nothing about something that is not an absolute path', () => {
    expect(toWindowsPath('home/b', UBUNTU)).toBeNull()
  })
})

describe('the path inside an argument', () => {
  it('translates an argument that is a path', () => {
    expect(translatePaths('C:\\Users\\b\\AppData\\mcp\\3f2.json', UBUNTU)).toBe('/mnt/c/Users/b/AppData/mcp/3f2.json')
  })

  it('translates the value of a config override, quoted or not', () => {
    expect(translatePaths('config_path="C:\\Users\\b\\x.toml"', UBUNTU)).toBe('config_path="/mnt/c/Users/b/x.toml"')
    expect(translatePaths('config_path=C:\\Users\\b\\x.toml', UBUNTU)).toBe('config_path=/mnt/c/Users/b/x.toml')
  })

  it('leaves prose alone, even where it reads like a drive', () => {
    // A Provider carries the Employee's instructions in a `-c key="…"` override, and that text has
    // escapes in it: `shaped like:\n` is the letter `e`, a colon and a backslash. Rewriting it put
    // `/mnt/e/` in the middle of a sentence the Employee was told to follow.
    const instructions = 'additional_developer_instructions="Each wake arrives shaped like:\\n\\n    [company]"'
    expect(translatePaths(instructions, UBUNTU)).toBe(instructions)
  })

  it('leaves a URL alone', () => {
    expect(translatePaths('http://127.0.0.1:4555/hook', UBUNTU)).toBe('http://127.0.0.1:4555/hook')
  })

  it('leaves a path into another distro exactly as it was', () => {
    const other = '\\\\wsl.localhost\\Debian\\home\\b\\x'
    expect(translatePaths(other, UBUNTU)).toBe(other)
  })

  it('undoes itself, which is how a test reads back what the adapter meant', () => {
    expect(untranslatePaths(translatePaths('C:\\Users\\b\\x.json', UBUNTU), UBUNTU)).toBe('C:\\Users\\b\\x.json')
    const prose = 'k="a sentence about /mnt/points and things"'
    expect(untranslatePaths(prose, UBUNTU)).toBe(prose)
  })
})

describe('wslpath, when the distro can answer', () => {
  it('is believed over the pure function: only it knows a moved automount root', () => {
    const run = (args: readonly string[]) => (args[0] === '-u' ? '/windows/c/x\n' : null)
    expect(wslPathVia(run, 'C:\\x', 'linux', UBUNTU)).toBe('/windows/c/x')
  })

  it('falls back to the pure answer when it is not there to ask', () => {
    expect(wslPathVia(() => null, 'C:\\x', 'linux', UBUNTU)).toBe('/mnt/c/x')
    expect(wslPathVia(() => null, '/mnt/c/x', 'windows', UBUNTU)).toBe('C:\\x')
  })
})

describe('a repo inside the distro’s own filesystem', () => {
  it('is recognised by either UNC spelling, so the app’s git can be told to trust it', () => {
    expect(wslUncDistro('\\\\wsl.localhost\\Ubuntu\\home\\b\\acme')).toBe('Ubuntu')
    expect(wslUncDistro('\\\\wsl$\\Debian\\home\\b\\acme')).toBe('Debian')
    expect(wslUncDistro('C:\\code\\acme')).toBeNull()
  })
})
