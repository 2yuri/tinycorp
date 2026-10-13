import { describe, expect, it } from 'vitest'
import { commitPlaceholder } from '../files/file-changes'
import { enterKey, modifierKey, shortcut } from './shortcuts'

/**
 * The screens were drawn on a Mac and said `⌘` everywhere (T166). The bindings always took
 * `ctrlKey` too, so a boss on Windows could press every one of them — they just had no way of
 * knowing which key to press.
 */

describe('modifierKey', () => {
  it('is ⌘ on a Mac and Ctrl everywhere else', () => {
    expect(modifierKey('darwin')).toBe('⌘')
    expect(modifierKey('win32')).toBe('Ctrl')
    expect(modifierKey('linux')).toBe('Ctrl')
  })
})

describe('enterKey', () => {
  it('is the glyph on a Mac and the word elsewhere, because no Windows key is marked ↵', () => {
    expect(enterKey('darwin')).toBe('↵')
    expect(enterKey('win32')).toBe('Enter')
  })
})

describe('shortcut', () => {
  it('runs the modifier into the key on a Mac and joins them with a + elsewhere', () => {
    expect(shortcut('darwin', 'S')).toBe('⌘S')
    expect(shortcut('win32', 'S')).toBe('Ctrl+S')
    expect(shortcut('darwin', 'K')).toBe('⌘K')
    expect(shortcut('win32', 'K')).toBe('Ctrl+K')
  })

  it('writes Return as each platform writes it', () => {
    expect(shortcut('darwin', '↵')).toBe('⌘↵')
    expect(shortcut('win32', '↵')).toBe('Ctrl+Enter')
  })
})

describe('commitPlaceholder', () => {
  it('says the key the boss actually has', () => {
    expect(commitPlaceholder('darwin')).toBe('Message (⌘↵ to commit)')
    expect(commitPlaceholder('win32')).toBe('Message (Ctrl+Enter to commit)')
  })
})
