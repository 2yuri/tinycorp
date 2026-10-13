import { CLIPBOARD_CLEAR_MS } from '../../shared/environments'

/**
 * Copying a secret to the clipboard, and taking it back (T176, frame `zpvHQ`).
 *
 * A value on the clipboard is a value in every app on the Mac that reads it, and in the clipboard
 * history the boss installed. So it is there for thirty seconds and then it is not.
 *
 * The one rule worth stating: it is cleared **only if it is still what we put there**. The boss
 * copied a password out of 1Password twenty seconds later, and wiping that would be the app
 * destroying something it never owned.
 */

/**
 * The part of Electron's `clipboard` this needs. Injected so a test needs no Electron, and async
 * because Electron's own reads and writes are: the clipboard is the system's, not this process's.
 */
export interface Clipboard {
  readText(): Promise<string> | string
  writeText(text: string): Promise<void> | void
  clear(): void
}

export interface ClipboardCopyOptions {
  clipboard: Clipboard
  /** How long the value stays. Defaults to the thirty seconds the footer promises. */
  afterMs?: number
  /** `setTimeout`, so a test drives it with a fake clock. */
  schedule?: (run: () => void, ms: number) => unknown
}

/** One copy in flight: what it put there, and when it will take it back. */
export interface ClipboardCopy {
  /** Clears it now, if it is still ours. Called by the timer, and by the next copy. */
  clear(): Promise<void>
}

export function copyForAWhile(
  value: string,
  { clipboard, afterMs = CLIPBOARD_CLEAR_MS, schedule = setTimeout }: ClipboardCopyOptions,
): ClipboardCopy {
  const written = Promise.resolve(clipboard.writeText(value))
  let cleared = false
  const copy: ClipboardCopy = {
    async clear() {
      if (cleared) return
      cleared = true
      await written
      // Somebody else's copy is somebody else's: only what we put there is taken back.
      if ((await clipboard.readText()) === value) clipboard.clear()
    },
  }
  schedule(() => void copy.clear(), afterMs)
  return copy
}
