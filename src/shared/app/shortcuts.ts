/**
 * How a shortcut is written, per platform (T166).
 *
 * Every shortcut in the app is bound to `metaKey || ctrlKey`, so a boss on Windows has always been
 * able to press it. What they could not do was read it: the screens are drawn from Pen frames made
 * on a Mac, so they all said `⌘`, which is not a key a Windows keyboard has. Nothing about the
 * binding changes here — only the words on the screen.
 */

/** The modifier every TinyCorp shortcut uses, as the platform writes it. */
export function modifierKey(platform: string): string {
  return platform === 'darwin' ? '⌘' : 'Ctrl'
}

/** The Return key: a glyph on a Mac, a word everywhere else. */
export function enterKey(platform: string): string {
  return platform === 'darwin' ? '↵' : 'Enter'
}

/**
 * One shortcut in full: `⌘S` on a Mac, `Ctrl+S` elsewhere, because macOS writes the modifier and
 * the key as one glyph run and Windows joins them with a `+`.
 */
export function shortcut(platform: string, key: string): string {
  const named = key === '↵' ? enterKey(platform) : key
  return platform === 'darwin' ? `${modifierKey(platform)}${named}` : `${modifierKey(platform)}+${named}`
}
