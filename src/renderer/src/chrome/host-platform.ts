import { modifierKey, shortcut } from '../../../shared/app/shortcuts'
import { type MachineWords, machineWords } from '../../../shared/platform/machine-words'

/**
 * Which platform the window is on, for the two things the renderer draws differently (T166): the
 * slots the title bar keeps clear for the window's own buttons, and the words a shortcut is
 * written in. It is on the preload rather than behind an invoke, so the first paint already knows.
 *
 * A window with no preload at all — every test, and the capture harnesses — reads as macOS, which
 * is the platform the Pen frames are drawn for. So does a render with no window at all, which is
 * how the markup tests call these components.
 */
export function hostPlatform(): string {
  if (typeof window === 'undefined') return 'darwin'
  return window.tinyCorp?.shell?.platform ?? 'darwin'
}

/** `⌘S` here, `Ctrl+S` on Windows. */
export function shortcutLabel(key: string): string {
  return shortcut(hostPlatform(), key)
}

/** The modifier on its own, for a hint that writes the key beside it. */
export function modifierLabel(): string {
  return modifierKey(hostPlatform())
}

/** `this Mac`, `Reveal in Finder`, `the keychain` — on a Mac. On a PC, the PC's words (T265). */
export function machineWordsHere(): MachineWords {
  return machineWords(hostPlatform())
}
