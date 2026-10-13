import { machineWords } from './machine-words'

/**
 * What the right mouse button does in an Employee's terminal (T249).
 *
 * Two habits, and neither is wrong. A boss who came from Windows Terminal or PuTTY expects the
 * right button to paste and nothing else; a boss who came from a Mac expects a menu. TinyCorp
 * cannot guess which, so it asks once — on the first launch on Windows — and keeps the answer in
 * the boss's own profile, where every Company on the machine reads the same one.
 *
 * The **other** behaviour is always one modifier away, so neither choice locks the other out: the
 * modifier is `Ctrl` everywhere except a Mac, where `Ctrl`-click is already the secondary click
 * and `Cmd` is the key that is free.
 *
 * Nothing in this file is node code: the terminal reads it to decide what a click meant, and Your
 * profile reads the same words to label the choice.
 */

/** Paste the clipboard, or open the terminal's menu. */
export const TERMINAL_RIGHT_CLICKS = ['paste', 'menu'] as const

export type TerminalRightClick = (typeof TERMINAL_RIGHT_CLICKS)[number]

export function isTerminalRightClick(value: unknown): value is TerminalRightClick {
  return typeof value === 'string' && (TERMINAL_RIGHT_CLICKS as readonly string[]).includes(value)
}

/**
 * What the right button does on a machine whose boss has not said (T249): it pastes on Windows,
 * where every terminal the boss already uses pastes, and opens the menu on a Mac and on Linux,
 * where every terminal the boss already uses opens one.
 */
export function defaultRightClick(platform: string): TerminalRightClick {
  return platform === 'win32' ? 'paste' : 'menu'
}

/** The setting in force: the boss's pick, or this platform's habit until they have one. */
export function rightClickSetting(stored: TerminalRightClick | null, platform: string): TerminalRightClick {
  return stored ?? defaultRightClick(platform)
}

/**
 * What one click meant: the setting, unless the modifier was held, in which case the other one.
 * `modifier` is `Cmd` on a Mac and `Ctrl` everywhere else — {@link rightClickModifier} names it.
 */
export function rightClickAction(setting: TerminalRightClick, modifier: boolean): TerminalRightClick {
  if (!modifier) return setting
  return setting === 'paste' ? 'menu' : 'paste'
}

/** The key that does the other thing, in the words the hint prints. */
export function rightClickModifier(platform: string): string {
  return machineWords(platform).modifier
}

/** The label on each choice where there is room for it (frames `laIUL`, `QFh5u`). */
export const RIGHT_CLICK_LABEL: Record<TerminalRightClick, string> = {
  paste: 'Paste on right-click',
  menu: 'Open context menu',
}

/** The same two in Your profile's 400px column, where the segment is half as wide (frame `t1VDYQ`). */
export const RIGHT_CLICK_SHORT: Record<TerminalRightClick, string> = {
  paste: 'Paste',
  menu: 'Open context menu',
}

/**
 * The line under the choice, which says what the *other* button press does — the half a boss
 * cannot discover by trying, and the reason neither choice is a trap.
 */
export function rightClickHint(setting: TerminalRightClick, platform: string): string {
  const key = rightClickModifier(platform)
  return setting === 'paste'
    ? `Right-click pastes the clipboard. ${key} + right-click opens the menu.`
    : `Right-click opens the menu. ${key} + right-click pastes the clipboard.`
}

/** The title of the setting, wherever it is drawn (frames `laIUL`, `t1VDYQ`). */
export const RIGHT_CLICK_TITLE = 'Right-click in the terminal'

/** The line under it on the first-launch step. */
export const RIGHT_CLICK_SUB = "In an Employee's live terminal. Pick what your hand expects."
