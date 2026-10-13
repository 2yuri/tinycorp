import { describe, expect, it } from 'vitest'
import {
  defaultRightClick,
  rightClickAction,
  rightClickHint,
  rightClickSetting,
  TERMINAL_RIGHT_CLICKS,
} from './terminal-right-click'

/**
 * What the right button does in an Employee's terminal (T249).
 *
 * The rule worth pinning is that **neither choice locks the other out**: whichever the boss picked,
 * the other one is one modifier away, and the hint says which. A build where the modifier did the
 * same thing as the plain click would pass a test about the setting and still leave a boss with no
 * way to paste.
 */

describe('what a right-click does by default', () => {
  it('pastes on Windows, where every terminal the boss already uses pastes', () => {
    expect(defaultRightClick('win32')).toBe('paste')
  })

  it('opens the menu on a Mac and on Linux, where every terminal the boss already uses does', () => {
    expect(defaultRightClick('darwin')).toBe('menu')
    expect(defaultRightClick('linux')).toBe('menu')
  })

  it('is what the boss said, once they have said it, on every platform', () => {
    expect(rightClickSetting('menu', 'win32')).toBe('menu')
    expect(rightClickSetting('paste', 'darwin')).toBe('paste')
    expect(rightClickSetting(null, 'win32')).toBe('paste')
  })
})

describe('the modifier', () => {
  it('does the other thing, whichever way round the setting is', () => {
    expect(rightClickAction('paste', false)).toBe('paste')
    expect(rightClickAction('paste', true)).toBe('menu')
    expect(rightClickAction('menu', false)).toBe('menu')
    expect(rightClickAction('menu', true)).toBe('paste')
  })

  it('leaves both behaviours reachable from either setting', () => {
    for (const setting of TERMINAL_RIGHT_CLICKS) {
      const reachable = [rightClickAction(setting, false), rightClickAction(setting, true)]
      expect([...reachable].sort()).toEqual([...TERMINAL_RIGHT_CLICKS].sort())
    }
  })
})

describe('the hint', () => {
  /**
   * `Ctrl`-click is already the secondary click on a Mac, so `Ctrl` there would be a hint for a
   * gesture the boss cannot make. The app says `Ctrl` where it means it (AGENTS.md).
   */
  it('names Cmd on a Mac and Ctrl everywhere else', () => {
    expect(rightClickHint('paste', 'darwin')).toContain('Cmd + right-click')
    expect(rightClickHint('paste', 'win32')).toContain('Ctrl + right-click')
    expect(rightClickHint('menu', 'linux')).toContain('Ctrl + right-click')
  })

  it('says what the plain click does first, and what the modifier does after', () => {
    expect(rightClickHint('paste', 'win32')).toBe(
      'Right-click pastes the clipboard. Ctrl + right-click opens the menu.',
    )
    expect(rightClickHint('menu', 'win32')).toBe('Right-click opens the menu. Ctrl + right-click pastes the clipboard.')
  })
})
