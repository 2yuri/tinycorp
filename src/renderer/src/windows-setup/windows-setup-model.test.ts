import { describe, expect, it } from 'vitest'
import { defaultBoss } from '../../../shared/boss-profile'
import type { WindowsMachine } from '../../../shared/platform/windows-machine'
import {
  canContinue,
  canPickWsl,
  distroOptions,
  draftRuntimeKey,
  showsGitBashNotice,
  windowsSetupDraft,
  windowsSetupTakesTheWindow,
} from './windows-setup-model'

/**
 * The rules behind the first launch on Windows (T249).
 *
 * Two of them are the whole ticket: the step is drawn on Windows and **once**, and it will not let
 * a boss through to a team that cannot work — a team on Windows with no Git for Windows has no
 * `bash` for the CLIs that need one and no `git` for anything. Everything else here is about not
 * making the boss work for an answer the machine already implies.
 */

const GIT_BASH = { path: 'C:\\Program Files\\Git\\bin\\bash.exe', lookedIn: ['PATH'] }
const NO_GIT_BASH = { path: null, lookedIn: ['PATH', 'C:\\Program Files\\Git\\bin'] }

function machine(over: Partial<WindowsMachine> = {}): WindowsMachine {
  return {
    windows: true,
    distros: [
      { name: 'Ubuntu', default: true },
      { name: 'Debian', default: false },
    ],
    gitBash: GIT_BASH,
    ...over,
  }
}

const boss = (over: Partial<ReturnType<typeof defaultBoss>> = {}) => ({ ...defaultBoss('Ada'), ...over })

describe('whether the step is drawn at all', () => {
  it('is drawn on Windows, once, before the boss has answered', () => {
    expect(windowsSetupTakesTheWindow(machine(), boss())).toBe(true)
  })

  it('is never drawn again once the boss has answered', () => {
    expect(windowsSetupTakesTheWindow(machine(), boss({ windowsSetupDone: true }))).toBe(false)
  })

  it('is not drawn on a Mac or a Linux desktop, whatever the profile says', () => {
    expect(windowsSetupTakesTheWindow({ ...machine(), windows: false }, boss())).toBe(false)
  })

  it('is not drawn before the machine or the profile has answered', () => {
    expect(windowsSetupTakesTheWindow(null, boss())).toBe(false)
    expect(windowsSetupTakesTheWindow(machine(), null)).toBe(false)
  })
})

describe('what the step opens on', () => {
  it('is WSL on a machine that has a distro, so Continue is one press', () => {
    expect(windowsSetupDraft(machine(), boss())).toEqual({ kind: 'wsl', distro: 'Ubuntu', rightClick: 'paste' })
  })

  it('is Windows on a machine with no WSL, where WSL cannot be picked at all', () => {
    const none = machine({ distros: [] })
    expect(windowsSetupDraft(none, boss())).toMatchObject({ kind: 'windows' })
    expect(canPickWsl(none)).toBe(false)
  })

  it('is what the boss saved, once they have saved something', () => {
    const saved = boss({ defaultRuntime: 'wsl:Debian', rightClick: 'menu' })
    expect(windowsSetupDraft(machine(), saved)).toEqual({ kind: 'wsl', distro: 'Debian', rightClick: 'menu' })
    expect(windowsSetupDraft(machine(), boss({ defaultRuntime: 'windows' }))).toMatchObject({ kind: 'windows' })
  })

  it('marks the distro Windows itself opens, and offers the rest as they are', () => {
    expect(distroOptions(machine())).toEqual([
      { value: 'Ubuntu', label: 'Ubuntu · default' },
      { value: 'Debian', label: 'Debian' },
    ])
  })
})

describe('what Continue saves', () => {
  it('is a runtime key the engine can read back', () => {
    expect(draftRuntimeKey({ kind: 'windows', distro: 'Ubuntu', rightClick: 'paste' })).toBe('windows')
    expect(draftRuntimeKey({ kind: 'wsl', distro: 'Ubuntu', rightClick: 'paste' })).toBe('wsl:Ubuntu')
  })

  it('names no place when WSL was picked on a machine with no distro', () => {
    expect(draftRuntimeKey({ kind: 'wsl', distro: '', rightClick: 'paste' })).toBeNull()
  })
})

/**
 * The step is the one screen in the app that holds. It holds on a fact about the machine — not on
 * a form being filled in — and the two ways past it are the two the footer names.
 */
describe('whether Continue may be pressed', () => {
  it('may not, while the team runs on Windows and Git for Windows is missing', () => {
    const draft = { kind: 'windows' as const, distro: 'Ubuntu', rightClick: 'paste' as const }
    const without = machine({ gitBash: NO_GIT_BASH })
    expect(canContinue(draft, without)).toBe(false)
    expect(showsGitBashNotice(draft, without)).toBe(true)
  })

  it('may, the moment Check again finds it', () => {
    const draft = { kind: 'windows' as const, distro: 'Ubuntu', rightClick: 'paste' as const }
    expect(canContinue(draft, machine())).toBe(true)
    expect(showsGitBashNotice(draft, machine())).toBe(false)
  })

  it('may, the moment the boss moves the team into WSL instead', () => {
    const draft = { kind: 'wsl' as const, distro: 'Ubuntu', rightClick: 'paste' as const }
    const without = machine({ gitBash: NO_GIT_BASH })
    expect(canContinue(draft, without)).toBe(true)
    // And the notice is about Windows, so it goes with the pick.
    expect(showsGitBashNotice(draft, without)).toBe(false)
  })

  it('may not, when WSL is picked but this machine has no distro to run in', () => {
    const draft = { kind: 'wsl' as const, distro: '', rightClick: 'paste' as const }
    expect(canContinue(draft, machine({ distros: [] }))).toBe(false)
  })
})
