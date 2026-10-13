import { describe, expect, it } from 'vitest'
import type { ProviderPlacement } from '../../shared/platform/wsl'
import {
  INSTALL_EITHER_LEAD,
  INSTALL_THERE_LEAD,
  missingBody,
  missingCheck,
  type PreflightWords,
  signedOutCheck,
} from './provider-preflight'

/**
 * The words on a Provider's card when the machine has two places to install a CLI (frame `c8knu`,
 * T167). On a Mac there is one, and none of this shows.
 */

const WORDS: PreflightWords = {
  name: 'Claude Code',
  command: 'claude',
  signIn: {
    statusArgs: ['auth', 'status'],
    installWith: 'npm install -g @anthropic-ai/claude-code',
    installOnWindows: 'irm https://claude.ai/install.ps1 | iex',
    installInWsl: 'curl -fsSL https://claude.ai/install.sh | bash',
    signInWith: 'claude /login',
    verdict: () => 'none',
  },
}

function placement(over: Partial<ProviderPlacement> = {}): ProviderPlacement {
  return {
    windows: false,
    distros: [],
    stopped: [],
    chosen: null,
    missingAt: null,
    lookedIn: ['Windows PATH', 'WSL: Ubuntu'],
    reach: 'untested',
    ...over,
  }
}

describe('a CLI that is in neither place', () => {
  const check = missingCheck({ ...WORDS, placement: placement() })

  it('offers both installs, because both are right', () => {
    expect(check.lead).toBe(INSTALL_EITHER_LEAD)
    expect(check.steps?.map((step) => step.command)).toEqual([
      'irm https://claude.ai/install.ps1 | iex',
      'curl -fsSL https://claude.ai/install.sh | bash',
      'claude /login',
    ])
  })

  it('says which shell each is typed in, and draws the prompt that shell draws', () => {
    expect(check.steps?.map((step) => [step.label, step.hint, step.prompt])).toEqual([
      ['Windows', 'PowerShell', '>'],
      ['WSL · Ubuntu', 'bash', '$'],
      ['Then sign in', 'where you installed it', '$'],
    ])
  })

  it('says where it looked, so a boss who did install it sees which place was missed', () => {
    expect(check.lookedIn).toBe('Looked in: Windows PATH · WSL: Ubuntu')
    expect(check.body).toContain('on Windows or inside WSL')
  })

  it('names every distro when none of them had it', () => {
    const many = missingCheck({ ...WORDS, placement: placement({ lookedIn: ['Windows PATH', 'WSL: Ubuntu, Debian'] }) })
    expect(many.steps?.map((step) => step.label)).toEqual(['Windows', 'WSL · Ubuntu', 'WSL · Debian', 'Then sign in'])
  })
})

describe('a Mac, where there is one place', () => {
  const check = missingCheck(WORDS)

  it('keeps the card it always had', () => {
    expect(check.steps).toBeUndefined()
    expect(check.commands).toEqual(['npm install -g @anthropic-ai/claude-code', 'claude /login'])
    expect(check.lookedIn).toBe('')
  })
})

/**
 * The sentence names the machine the boss is sitting at (T250). It said "on this Mac" everywhere,
 * which on a Linux desktop is wrong and on a Windows is wrong twice — the word and the place.
 */
describe('where the CLI was not', () => {
  it('says this Mac on a Mac, and this computer on anything else with one place to look', () => {
    expect(missingBody(WORDS, 'darwin')).toContain('the claude command on this Mac —')
    expect(missingBody(WORDS, 'linux')).toContain('the claude command on this computer —')
  })

  it('says Windows on a Windows with no WSL, where there is still one place to look', () => {
    expect(missingBody(WORDS, 'win32')).toContain('the claude command on Windows —')
    expect(missingBody({ ...WORDS, placement: placement({ lookedIn: ['Windows PATH'] }) }, 'win32')).toContain(
      'the claude command on Windows —',
    )
  })

  it('names both places on a Windows with WSL, whatever the platform says', () => {
    const both = { ...WORDS, placement: placement() }
    expect(missingBody(both, 'win32')).toContain('on Windows or inside WSL')
  })
})

describe('a CLI that is there and signed out', () => {
  it('names where it is, when there is more than one where', () => {
    const check = signedOutCheck({
      ...WORDS,
      placement: placement({ windows: true, distros: ['Ubuntu'], chosen: { kind: 'wsl', distro: 'Ubuntu' } }),
    })
    // The login belongs to the installation: signing in on Windows does nothing for the one in Ubuntu.
    expect(check.body).toContain('in WSL · Ubuntu')
  })

  it('says nothing about a place on a machine that has one', () => {
    expect(signedOutCheck(WORDS).body).not.toContain('WSL')
  })
})

/**
 * The card for the machine T258 was reported on: the boss chose WSL, `claude` is on the Windows
 * `PATH`, and the app used to move their Employees to Windows and say nothing at all. Now the card
 * is drawn, and it says the one true thing — this Provider is not installed *there* — with both ways
 * out of it: install it in that place, or run this Provider where the CLI already is.
 */
describe('a place the boss chose that the CLI is not in', () => {
  const inArch = placement({
    windows: true,
    missingAt: { kind: 'wsl', distro: 'Arch' },
    lookedIn: ['Windows PATH', 'WSL: Arch'],
  })
  const check = missingCheck({ ...WORDS, placement: inArch })

  it('names that place in the title, rather than saying "not installed"', () => {
    expect(check.title).toBe('Claude Code is not installed in WSL · Arch')
  })

  it('offers that place’s own install command, and only that one', () => {
    expect(check.lead).toBe(INSTALL_THERE_LEAD)
    expect(check.steps?.map((step) => [step.label, step.command])).toEqual([
      ['WSL · Arch', 'curl -fsSL https://claude.ai/install.sh | bash'],
      ['Then sign in', 'claude /login'],
    ])
  })

  it('says where the CLI is instead, which is the one-click way out', () => {
    expect(check.body).toContain('in WSL · Arch, where you chose to run it')
    expect(check.body).toContain('Or pick Windows for this Provider in Your profile → Providers.')
  })

  it('offers nowhere else when there is nowhere else: the CLI is simply not on this machine', () => {
    const nowhere = missingCheck({
      ...WORDS,
      placement: placement({ missingAt: { kind: 'wsl', distro: 'Arch' }, lookedIn: ['Windows PATH', 'WSL: Arch'] }),
    })
    expect(nowhere.body).not.toContain('Your profile')
  })

  it('names another distro when that is where the CLI is', () => {
    const elsewhere = missingCheck({
      ...WORDS,
      placement: placement({
        distros: ['Ubuntu'],
        missingAt: { kind: 'wsl', distro: 'Arch' },
        lookedIn: ['Windows PATH', 'WSL: Arch, Ubuntu'],
      }),
    })
    expect(elsewhere.body).toContain('Or pick WSL · Ubuntu for this Provider in Your profile → Providers.')
  })
})
