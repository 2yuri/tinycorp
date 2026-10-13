import type { Boss } from '../../../shared/boss-profile'
import { gitBashProviders } from '../../../shared/domain/providers'
import type { TerminalRightClick } from '../../../shared/platform/terminal-right-click'
import { rightClickSetting } from '../../../shared/platform/terminal-right-click'
import type { WindowsMachine } from '../../../shared/platform/windows-machine'
import { windowsOptionDesc } from '../../../shared/platform/windows-machine'
import { distroLabel, type ProviderRuntime, parseRuntimeKey, runtimeKey } from '../../../shared/platform/wsl'

/**
 * The two answers the first launch on Windows asks for, and the rules that decide what the screen
 * may do with them (T249, frames `laIUL`, `QFh5u`, `t1VDYQ`).
 *
 * All of it is here rather than in the components because all of it is a rule rather than a
 * drawing: which option opens selected, whether `Continue` may be pressed, what a pick is stored
 * as. A component that decided any of those would be a rule nothing could test without a window.
 */

/** Where the team runs, as the two option cards put it. */
export type TeamRuntimeKind = 'windows' | 'wsl'

export interface WindowsSetupDraft {
  kind: TeamRuntimeKind
  /** The distro the WSL option runs in. Empty on a machine with none. */
  distro: string
  rightClick: TerminalRightClick
}

/**
 * What the step opens on, so `Continue` is one press for the boss who has nothing to change:
 * **WSL when this machine has a distro**, because that is where a developer's toolchain already
 * is and where none of the Git Bash question applies, and Windows when it has none. The right
 * button pastes, which is what every terminal on this machine already does.
 *
 * A boss who has been here before — Your profile, or a second launch — opens on what they saved.
 */
export function windowsSetupDraft(machine: WindowsMachine, boss: Boss | null, platform = 'win32'): WindowsSetupDraft {
  const stored = parseRuntimeKey(boss?.defaultRuntime ?? null)
  const first = machine.distros[0]?.name ?? ''
  if (stored?.kind === 'wsl') return draft('wsl', stored.distro, boss, platform)
  if (stored?.kind === 'windows') return draft('windows', first, boss, platform)
  return draft(first ? 'wsl' : 'windows', first, boss, platform)
}

function draft(kind: TeamRuntimeKind, distro: string, boss: Boss | null, platform: string): WindowsSetupDraft {
  return { kind, distro, rightClick: rightClickSetting(boss?.rightClick ?? null, platform) }
}

/** The place a draft names, or null when it names none — WSL on a machine with no distro. */
export function draftRuntime(draft: WindowsSetupDraft): ProviderRuntime | null {
  if (draft.kind === 'windows') return { kind: 'windows' }
  return draft.distro ? { kind: 'wsl', distro: draft.distro } : null
}

/** What the draft is stored as in the boss's profile, or null when it names no place. */
export function draftRuntimeKey(draft: WindowsSetupDraft): string | null {
  const runtime = draftRuntime(draft)
  return runtime ? runtimeKey(runtime) : null
}

/**
 * Whether the boss may press `Continue`.
 *
 * A team that runs on Windows without Git for Windows is a team that cannot work: the CLIs that
 * run their commands through `bash` have none, and git itself comes from that same install. So the
 * step holds — and the way past it is either to install it and press `Check again`, or to move the
 * team into WSL, where the question does not arise. It is the one screen in the app that blocks,
 * and it blocks on a fact about the machine rather than on a form being filled in.
 */
export function canContinue(draft: WindowsSetupDraft, machine: WindowsMachine): boolean {
  if (draft.kind === 'wsl') return draft.distro !== ''
  return needsGitBash().length === 0 || machine.gitBash.path !== null
}

/** Why `Continue` cannot be pressed, or empty when it can. */
export function blockedNote(draft: WindowsSetupDraft, machine: WindowsMachine, blocked: string): string {
  return canContinue(draft, machine) ? '' : blocked
}

/** Whether the Git Bash notice is drawn at all: only for a team on Windows that has none. */
export function showsGitBashNotice(draft: WindowsSetupDraft, machine: WindowsMachine): boolean {
  return draft.kind === 'windows' && machine.gitBash.path === null && needsGitBash().length > 0
}

/** Whether WSL can be picked here: only on a machine that has a distro to pick. */
export function canPickWsl(machine: WindowsMachine): boolean {
  return machine.distros.length > 0
}

/** The distro dropdown's options, the default one marked as the frame marks it. */
export function distroOptions(machine: WindowsMachine): { value: string; label: string }[] {
  return machine.distros.map((distro) => ({ value: distro.name, label: distroLabel(distro.name, distro.default) }))
}

/** What the Windows option card says, with whichever products the catalogue says need Git Bash. */
export function windowsOptionText(): string {
  return windowsOptionDesc(needsGitBash())
}

/** The products that need Git for Windows, by name. Read here so no screen writes one down. */
export function needsGitBash(): string[] {
  return gitBashProviders()
}

/**
 * Whether the first-launch step takes the window: this is a Windows desktop, the boss has not been
 * asked yet, and the machine has answered. Never on a Mac or a Linux desktop, and never twice.
 */
export function windowsSetupTakesTheWindow(machine: WindowsMachine | null, boss: Boss | null): boolean {
  if (!machine || !boss) return false
  return machine.windows && !boss.windowsSetupDone
}
