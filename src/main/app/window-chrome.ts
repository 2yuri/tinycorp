import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The window's own frame, per platform (T166).
 *
 * The app draws its own 44px title bar, so the platform's is hidden on all of them — but hiding it
 * is where the platforms stop agreeing. macOS keeps its three traffic lights and lets the app say
 * where they sit; Windows and Linux draw nothing at all unless the window asks for the overlay,
 * and a window with no minimise, maximise or close button is a window a boss cannot put away.
 *
 * The overlay's colours are the design's own — the title bar's `--card` behind the buttons and
 * `--muted-foreground` for the glyphs, the same colour the two buttons beside them are drawn in —
 * so the strip reads as part of the bar rather than as a piece of Windows laid over it.
 */

/** The title bar the renderer draws, in CSS pixels. The overlay is made to match it. */
export const TITLE_BAR_HEIGHT = 44

/** `--card` and `--muted-foreground` from `ui/tokens.css`, which is Dark by default. */
export const TITLE_BAR_OVERLAY = {
  color: '#1E293B',
  symbolColor: '#94A3B8',
  height: TITLE_BAR_HEIGHT,
} as const

/**
 * How wide the window buttons are where the platform draws them into the overlay: three 46px
 * buttons at 100% scale. The renderer keeps this much of the bar clear on its right, exactly as it
 * keeps the traffic lights' slot clear on its left (`shell.css`).
 */
export const WINDOW_CONTROLS_WIDTH = 138

export type WindowChrome = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'
>

/** The frame options for `platform`. */
export function windowChrome(platform: NodeJS.Platform = process.platform): WindowChrome {
  if (platform === 'darwin') {
    // macOS draws 14px buttons; this centres the first on the design's 12px dot (22, 22).
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 15, y: 15 } }
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: { ...TITLE_BAR_OVERLAY } }
}
