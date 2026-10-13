import { describe, expect, it } from 'vitest'
import {
  AI_JAIL_BREW,
  AI_JAIL_CARGO,
  AI_JAIL_YAY,
  EMPTY_SANDBOX_PLAN,
  linuxFlavour,
  SANDBOX_NOT_FOUND,
  SANDBOX_ON_WINDOWS,
  SANDBOX_UNSUPPORTED,
  type SandboxStatus,
  sandboxArgs,
  sandboxCommand,
  sandboxInstall,
  sandboxLookedIn,
  sandboxStatusWords,
  sandboxToggleEnabled,
  sandboxUnjailed,
  sandboxUsable,
  sandboxVersionOf,
} from './index'

/**
 * ai-jail as the card reports it (T260).
 *
 * The one thing every case here is about: **the machine decides**. A line the boss is offered has
 * to be a line that machine can really run, and Windows itself has to read as *there is nothing to
 * install* rather than as an install that has not happened yet.
 */

const found: SandboxStatus = { state: 'found', version: '2.2.0', path: '/opt/homebrew/bin/ai-jail', lookedIn: ['PATH'] }

describe('the version ai-jail reports', () => {
  it('is read out of its own line', () => {
    expect(sandboxVersionOf('ai-jail 2.2.0')).toBe('2.2.0')
    expect(sandboxVersionOf('ai-jail 2.2.0 (abc1234)\n')).toBe('2.2.0')
  })

  it('is nothing at all when the answer names no version', () => {
    expect(sandboxVersionOf('ai-jail')).toBeNull()
    expect(sandboxVersionOf('')).toBeNull()
  })
})

describe('which Linux this is', () => {
  it('is an Arch when it says so', () => {
    expect(linuxFlavour('NAME="Arch Linux"\nID=arch\n')).toBe('arch')
  })

  it('is an Arch when it is only like one, which is what Manjaro says', () => {
    expect(linuxFlavour('ID=manjaro\nID_LIKE=arch\n')).toBe('arch')
    expect(linuxFlavour('ID=endeavouros\nID_LIKE="arch"\n')).toBe('arch')
  })

  it('is anything else otherwise, including a machine that ships no os-release', () => {
    expect(linuxFlavour('ID=ubuntu\nID_LIKE=debian\n')).toBe('other')
    expect(linuxFlavour(null)).toBe('other')
  })

  it('does not read an Arch out of a word that merely contains one', () => {
    expect(linuxFlavour('ID=archlinuxarm-ish\n')).toBe('other')
  })
})

describe('the line the boss runs', () => {
  it('is Homebrew on a Mac', () => {
    expect(sandboxInstall({ platform: 'darwin' })).toEqual([{ label: 'macOS', command: AI_JAIL_BREW }])
  })

  it('is yay on an Arch, where a binary package is published', () => {
    expect(sandboxInstall({ platform: 'linux', flavour: 'arch' })).toEqual([{ label: 'Arch', command: AI_JAIL_YAY }])
  })

  it('is Cargo on any other Linux', () => {
    expect(sandboxInstall({ platform: 'linux', flavour: 'other' })).toEqual([
      { label: 'Linux', command: AI_JAIL_CARGO },
    ])
  })

  it('is the distro’s own line, labelled with the distro, when the team runs in WSL', () => {
    expect(sandboxInstall({ platform: 'win32', flavour: 'arch', distro: 'Arch' })).toEqual([
      { label: 'Arch', command: AI_JAIL_YAY },
    ])
    expect(sandboxInstall({ platform: 'win32', flavour: 'other', distro: 'Ubuntu' })).toEqual([
      { label: 'Ubuntu', command: AI_JAIL_CARGO },
    ])
  })

  it('is no line at all on Windows itself, because there is nothing there to install', () => {
    expect(sandboxInstall({ platform: 'win32' })).toEqual([])
  })
})

describe('where the app looked', () => {
  it('is this computer’s PATH, or the distro’s own', () => {
    expect(sandboxLookedIn(null)).toEqual(['PATH'])
    expect(sandboxLookedIn('Arch')).toEqual(['Arch PATH'])
  })
})

describe('what the card says, and whether the toggle can be pressed', () => {
  it('names the version and the path when it is found', () => {
    expect(sandboxStatusWords(found)).toEqual({
      title: 'Found',
      body: 'ai-jail 2.2.0 · /opt/homebrew/bin/ai-jail',
    })
    expect(sandboxToggleEnabled(found)).toBe(true)
    expect(sandboxUsable(found)).toBe(true)
  })

  it('says TinyCorp does not install it, and refuses the toggle, when it is missing', () => {
    expect(sandboxStatusWords(SANDBOX_NOT_FOUND).title).toBe('Not installed')
    expect(sandboxToggleEnabled(SANDBOX_NOT_FOUND)).toBe(false)
    expect(sandboxUsable(SANDBOX_NOT_FOUND)).toBe(false)
  })

  it('says Windows itself is not a place it runs, in the frame’s own sentence', () => {
    expect(sandboxStatusWords(SANDBOX_UNSUPPORTED)).toEqual({
      title: 'Not on Windows',
      body: SANDBOX_ON_WINDOWS,
    })
    expect(sandboxToggleEnabled(SANDBOX_UNSUPPORTED)).toBe(false)
  })
})

describe('the line a Session is started with', () => {
  const plan = { readOnly: ['/data/sessions'], readWrite: ['/data/rtk'], env: ['TINYCORP_HOOK_TOKEN'] }

  /**
   * The whole argv, pinned. It is pinned rather than spot-checked because every flag in it is load
   * bearing and none of it was ever executed (see `docs/sandbox.md`): the tests are what say the
   * line is the line ai-jail's own documentation describes.
   */
  it('is ai-jail’s flags, then `--`, then the Provider’s own command untouched', () => {
    expect(sandboxCommand(plan, 'claude', ['--resume', 'abc'])).toEqual([
      'ai-jail',
      '--agent-state',
      '--worktree',
      '--network',
      '--ro-map',
      '/data/sessions',
      '--rw-map',
      '/data/rtk',
      '--env',
      'TINYCORP_HOOK_TOKEN',
      '--',
      'claude',
      '--resume',
      'abc',
    ])
  })

  it('always mounts the login, the git dirs a linked worktree commits through, and an open network', () => {
    // `--worktree` is the one an Employee cannot work without: its `.git` is a file pointing into
    // the main repo, so without the shared common dir `git commit` fails inside the jail.
    expect(sandboxArgs(EMPTY_SANDBOX_PLAN)).toEqual(['--agent-state', '--worktree', '--network'])
  })

  it('never filters the network, because filtering would cut the Session off from TinyCorp', () => {
    const line = sandboxCommand(plan, 'codex', [])
    expect(line).toContain('--network')
    expect(line).not.toContain('--allow-host')
    expect(line).not.toContain('--allow-tcp-port')
  })

  it('names a folder once however many times the caller did, and drops empties', () => {
    expect(sandboxArgs({ readOnly: ['/a', '/a', ''], readWrite: ['/b', '/b'], env: ['X', 'X'] })).toEqual([
      '--agent-state',
      '--worktree',
      '--network',
      '--ro-map',
      '/a',
      '--rw-map',
      '/b',
      '--env',
      'X',
    ])
  })
})

describe('an Employee the boss asked to jail and this machine cannot', () => {
  it('is the add-on on and ai-jail nowhere — which is every Employee on Windows itself', () => {
    expect(sandboxUnjailed(SANDBOX_UNSUPPORTED, { enabled: true })).toBe(true)
    expect(sandboxUnjailed(SANDBOX_NOT_FOUND, { enabled: true })).toBe(true)
  })

  it('is nobody when the add-on is off, or when ai-jail is there to run', () => {
    expect(sandboxUnjailed(SANDBOX_UNSUPPORTED, { enabled: false })).toBe(false)
    expect(sandboxUnjailed(found, { enabled: true })).toBe(false)
  })
})
