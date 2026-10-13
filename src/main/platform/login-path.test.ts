import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptLoginShellPath, loginShell, mergePath, readLoginShellPath, wellKnownBins } from './login-path'

/**
 * A Mac and a Linux question, written in their `PATH`: `:` between folders, `/opt/homebrew/bin`,
 * a login shell to ask. `adoptLoginShellPath` returns without doing anything on Windows — a GUI
 * app there already has the user's own `PATH` — so on Windows there is nothing here to be right
 * about, and the assertions would only be about `path.delimiter` (T166).
 */
describe.skipIf(process.platform === 'win32')('the PATH a Finder-opened app adopts', () => {
  it('reads the login shell’s PATH between its marks, whatever an rc file printed first', () => {
    const run = () => 'Welcome back!\n__TINYCORP_PATH__/Users/b/.local/bin:/usr/bin__TINYCORP_PATH__'
    expect(readLoginShellPath('/bin/zsh', run)).toBe('/Users/b/.local/bin:/usr/bin')
  })

  it('gives up quietly when the shell cannot be asked', () => {
    expect(
      readLoginShellPath('/bin/zsh', () => {
        throw new Error('timeout')
      }),
    ).toBeNull()
  })

  it('keeps what it had first, adds the shell’s and the installers’ folders, each once', () => {
    expect(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin', ['/opt/homebrew/bin', '/x'])).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin:/x',
    )
  })

  it('knows where Claude Code’s own installer and Homebrew put a CLI', () => {
    expect(wellKnownBins('/Users/b', 'darwin')).toEqual(
      expect.arrayContaining([join('/Users/b', '.local', 'bin'), '/opt/homebrew/bin']),
    )
  })
})

/**
 * A Linux desktop misses the shell's PATH exactly the way the Finder does (T177): an app started
 * from GNOME's overview or a `.desktop` entry is started by the session, not by a shell, so nvm's
 * shims and `~/.local/bin` are not there — and the boss is told the CLI they use every day is not
 * installed. This ran on macOS and Linux already, by not running on Windows; what was missing was
 * a Linux answer to *which shell* and *which folders*, and anything holding it to either.
 */
describe('the PATH adopted on a Linux desktop', () => {
  // Joined with this machine's own delimiter, so the fixture says the same thing on the Windows
  // runner, where `mergePath` writes `;` between folders (T166).
  const linux = (had: string[], login: string | null = null) => {
    const env: NodeJS.ProcessEnv = { PATH: had.join(delimiter) }
    adoptLoginShellPath({ env, platform: 'linux', home: '/home/boss', readPath: () => login })
    return (env['PATH'] ?? '').split(delimiter)
  }

  it('runs on Linux: the session’s bare PATH is widened, not left as it was', () => {
    const path = linux(['/usr/local/bin', '/usr/bin', '/bin'], '/home/boss/.nvm/versions/node/v24.0.0/bin')

    expect(path).toContain('/home/boss/.nvm/versions/node/v24.0.0/bin')
    // What it already had stays, and stays first.
    expect(path.slice(0, 3)).toEqual(['/usr/local/bin', '/usr/bin', '/bin'])
  })

  it('knows where a Linux installs a CLI: linuxbrew, a snap, and the boss’s own bin', () => {
    const path = linux(['/usr/bin'])

    expect(path).toEqual(
      // `~/.local/bin` is joined the way the module joins it, so this says the same thing on the
      // Windows runner; the other two are literals there and here.
      expect.arrayContaining([join('/home/boss', '.local', 'bin'), '/home/linuxbrew/.linuxbrew/bin', '/snap/bin']),
    )
    // Homebrew's Apple Silicon folder is a Mac fact and has no business on a Linux PATH.
    expect(path).not.toContain('/opt/homebrew/bin')
  })

  it('asks the boss’s own shell, and bash rather than zsh where they have not said', () => {
    expect(loginShell({ SHELL: '/usr/bin/fish' }, 'linux')).toBe('/usr/bin/fish')
    expect(loginShell({}, 'linux')).toBe('/bin/bash')
    expect(loginShell({}, 'darwin')).toBe('/bin/zsh')
  })

  it('leaves a Windows GUI app’s PATH exactly as it was: it already has the boss’s own', () => {
    const env = { PATH: 'C:\\Windows\\system32' }
    adoptLoginShellPath({ env, platform: 'win32', home: 'C:\\Users\\b', readPath: () => '/should/not/be/read' })

    expect(env.PATH).toBe('C:\\Windows\\system32')
  })
})
