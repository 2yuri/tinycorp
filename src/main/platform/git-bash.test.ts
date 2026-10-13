import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findGitBash } from './git-bash'

/**
 * Finding Git for Windows' `bash.exe` (T249), against a made-up `PATH` and a made-up file system.
 *
 * Nothing here needs a Windows to run on and nothing here touches a disk: the machine is entirely
 * in the fixtures, which is the only way the Mac runner and the Windows runner can both run it.
 *
 * `join` rather than a written-out `C:\…`, so the fixture and the assertion say the same thing on
 * whichever platform the suite is on (`docs/engineering.md`, and `onDisk` for the engine's paths).
 */

const PROGRAM_FILES = join('C:', 'Program Files')
const GIT_BASH = join(PROGRAM_FILES, 'Git', 'bin', 'bash.exe')

/** A machine with these files on it and nothing on `PATH` unless a test says so. */
function machine(files: string[], onPath: string | null = null) {
  return findGitBash({
    platform: 'win32',
    env: { ProgramFiles: PROGRAM_FILES },
    exists: (path) => files.includes(path),
    onPath: () => onPath,
  })
}

describe('Git Bash on a Windows machine', () => {
  it('is what is on the PATH when the installer put it there', () => {
    const found = machine([], GIT_BASH)
    expect(found.path).toBe(GIT_BASH)
    expect(found.lookedIn).toEqual(['PATH'])
  })

  it('is found in Program Files when nothing on the PATH answers', () => {
    const found = machine([GIT_BASH])
    expect(found.path).toBe(GIT_BASH)
    // The card says everywhere it looked, so a boss who installed it elsewhere can see why — and
    // it names the folders they would check in Explorer, not the roots underneath them.
    expect(found.lookedIn).toContain('PATH')
    expect(found.lookedIn).toContain(join(PROGRAM_FILES, 'Git', 'bin'))
  })

  it('is found in the per-user install under LOCALAPPDATA', () => {
    const local = join('C:', 'Users', 'b', 'AppData', 'Local')
    const bash = join(local, 'Programs', 'Git', 'bin', 'bash.exe')
    const found = findGitBash({
      platform: 'win32',
      env: { LOCALAPPDATA: local },
      exists: (path) => path === bash,
      onPath: () => null,
    })
    expect(found.path).toBe(bash)
  })

  it('is the msys copy under usr\\bin when the installer left no bin\\bash.exe', () => {
    const usr = join(PROGRAM_FILES, 'Git', 'usr', 'bin', 'bash.exe')
    expect(machine([usr]).path).toBe(usr)
  })

  it('is missing when this machine has none, having been looked for everywhere', () => {
    const found = machine([])
    expect(found.path).toBeNull()
    expect(found.lookedIn.length).toBeGreaterThan(1)
  })

  /**
   * The bug this check exists to catch. `C:\Windows\System32\bash.exe` is the WSL launcher, and it
   * is on the `PATH` of every machine that ever enabled the feature — so a check that took it for
   * Git Bash would report "found" on precisely the machines that have no `bash` for the Windows
   * side at all, and the Sessions would fail at their first command with nothing having warned.
   */
  it('is not the WSL launcher in System32, whatever the PATH says', () => {
    const wslLauncher = join('C:', 'Windows', 'System32', 'bash.exe')
    expect(machine([], wslLauncher).path).toBeNull()
    // And the real one is still found behind it.
    expect(machine([GIT_BASH], wslLauncher).path).toBe(GIT_BASH)
  })

  it('reads ProgramFiles by whatever case this Windows spells the variable in (T166)', () => {
    const found = findGitBash({
      platform: 'win32',
      env: { programfiles: PROGRAM_FILES },
      exists: (path) => path === GIT_BASH,
      onPath: () => null,
    })
    expect(found.path).toBe(GIT_BASH)
  })
})

describe('Git Bash anywhere else', () => {
  it('is not asked about on a Mac: there is no question there, and a row about it would be noise', () => {
    const found = findGitBash({
      platform: 'darwin',
      env: {},
      exists: () => true,
      onPath: () => '/bin/bash',
    })
    expect(found).toEqual({ path: null, lookedIn: [] })
  })
})
