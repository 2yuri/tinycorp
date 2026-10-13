import { afterEach, describe, expect, it } from 'vitest'
import { hostPlatform, modifierLabel, shortcutLabel } from './host-platform'

/**
 * The renderer draws two things differently per platform (T166): the slots the title bar keeps
 * clear for the window's own buttons, and the words a shortcut is written in. Both read this, so
 * this is where "a window with no preload is a Mac" is written down.
 */

const holder = globalThis as { window?: unknown }
const original = holder.window

afterEach(() => {
  if (original === undefined) delete holder.window
  else holder.window = original
})

function windowOn(platform: string): void {
  holder.window = { tinyCorp: { shell: { platform } } }
}

describe('hostPlatform', () => {
  it('is what the preload says', () => {
    windowOn('win32')

    expect(hostPlatform()).toBe('win32')
  })

  it('is macOS where there is no preload to ask — every test, and the capture harnesses', () => {
    holder.window = {}
    expect(hostPlatform()).toBe('darwin')

    delete holder.window
    expect(hostPlatform()).toBe('darwin')
  })
})

describe('what a shortcut is written as', () => {
  it('follows the platform the window is on', () => {
    windowOn('darwin')
    expect(modifierLabel()).toBe('⌘')
    expect(shortcutLabel('S')).toBe('⌘S')
    expect(shortcutLabel('↵')).toBe('⌘↵')

    windowOn('win32')
    expect(modifierLabel()).toBe('Ctrl')
    expect(shortcutLabel('S')).toBe('Ctrl+S')
    expect(shortcutLabel('↵')).toBe('Ctrl+Enter')
  })
})
