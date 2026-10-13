/**
 * How wide the Employee drawer opens. The boss can drag it wider, and it comes back that wide the
 * next time a drawer opens, in this window and the next one.
 */
export const DRAWER_WIDTH = 440
/** Narrower than this and the tabs stop fitting; wider than the window makes no sense. */
export const MIN_DRAWER_WIDTH = 360
const WIDTH_KEY = 'tinycorp.drawer.width'

export function clampWidth(width: number, windowWidth: number): number {
  const max = Math.max(MIN_DRAWER_WIDTH, windowWidth - 320)
  return Math.round(Math.min(max, Math.max(MIN_DRAWER_WIDTH, width)))
}

/** The kept width, or the default when nothing sane is stored (storage can be off, or hold junk). */
export function rememberedWidth(windowWidth: number): number {
  try {
    const kept = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(kept) && kept > 0 ? clampWidth(kept, windowWidth) : DRAWER_WIDTH
  } catch {
    return DRAWER_WIDTH
  }
}

export function rememberWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // Nothing to do: the drawer opens at its default next time.
  }
}
