import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIPBOARD_CLEAR_MS } from '../../shared/environments'
import { type Clipboard, copyForAWhile } from './clipboard-copy'

/** Copy, and the thirty seconds the footer promises (T176), on a clock the test owns. */

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function fakeClipboard(): Clipboard & { text: string } {
  return {
    text: '',
    readText() {
      return this.text
    },
    writeText(text) {
      this.text = text
    },
    clear() {
      this.text = ''
    },
  }
}

const VALUE = 'postgres://app:h7fs8@db.internal:5432/billing'

describe('Copying a value', () => {
  it('puts it on the clipboard and takes it back after thirty seconds', async () => {
    const clipboard = fakeClipboard()

    copyForAWhile(VALUE, { clipboard })

    expect(clipboard.text).toBe(VALUE)
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1)
    expect(clipboard.text).toBe(VALUE)
    await vi.advanceTimersByTimeAsync(1)
    expect(clipboard.text).toBe('')
  })

  it('leaves the clipboard alone when it no longer holds what we put there', async () => {
    const clipboard = fakeClipboard()
    copyForAWhile(VALUE, { clipboard })

    clipboard.writeText('something the boss copied since')
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)

    expect(clipboard.text).toBe('something the boss copied since')
  })

  it('can be cleared early, and clearing twice does nothing the second time', async () => {
    const clipboard = fakeClipboard()
    const copy = copyForAWhile(VALUE, { clipboard })

    await copy.clear()
    clipboard.writeText('something else')
    await copy.clear()
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)

    expect(clipboard.text).toBe('something else')
  })
})
