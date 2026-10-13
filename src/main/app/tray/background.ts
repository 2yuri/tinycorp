/**
 * The Company keeps working when the window is closed (T117).
 *
 * Closing the last window used to be the end of the app on every platform but macOS, and on macOS
 * it left nothing to come back through. Here the window is only a view of the engine: closing it
 * puts the app in the menu bar, where the item says what the floor is doing and brings a window
 * back. The Sessions are never told about it. Only quitting stops them, which it still does, at
 * `will-quit`, exactly as before.
 *
 * Nothing here talks to the engine: it is handed `shutdown` and `openWindow`, so the day the engine
 * moves into a process of its own this module does not change.
 */

/** The bits of Electron's `app` the background needs. Electron's own satisfies it. */
export interface BackgroundApp {
  on(event: 'window-all-closed' | 'activate' | 'will-quit', listener: () => void): void
  quit(): void
  /** macOS only: the Dock icon can go while the menu-bar item stays; Electron has none elsewhere. */
  dock?: { hide(): void; show(): unknown } | null | undefined
}

export interface BackgroundOptions<AppWindow> {
  app: BackgroundApp
  /** Brings a window to the front, creating one when there is none. */
  openWindow(): AppWindow
  /** How many windows are open right now. */
  windowCount(): number
  /** What quitting does: stop every Session and close the engine. */
  shutdown(): void
  /**
   * Whether there is a menu-bar item to come back through. Without one the app would be a process
   * nobody can see, so the last window closing still ends it.
   */
  hasMenuBarItem: boolean
  platform?: NodeJS.Platform
}

export interface Background<AppWindow> {
  /** True while the app runs with no window: the Company works, the menu bar speaks for it. */
  inBackground(): boolean
  /** Brings a window back and, on macOS, the Dock icon with it. Every way back in goes through here. */
  open(): AppWindow
  /** Quit for real. */
  quit(): void
}

export function runInBackground<AppWindow>({
  app,
  openWindow,
  windowCount,
  shutdown,
  hasMenuBarItem,
  platform = process.platform,
}: BackgroundOptions<AppWindow>): Background<AppWindow> {
  let background = false
  const mac = platform === 'darwin'

  const control: Background<AppWindow> = {
    inBackground: () => background,

    open() {
      background = false
      // The Dock icon comes back before the window, so the app is never a window with no icon.
      if (mac) void app.dock?.show()
      return openWindow()
    },

    quit() {
      app.quit()
    },
  }

  app.on('window-all-closed', () => {
    if (!hasMenuBarItem) return app.quit()
    background = true
    // macOS first: the app lives in the menu bar, and the Dock has nothing to show.
    if (mac) app.dock?.hide()
  })

  // The Dock icon or the app switcher: the boss asks for the app back without the menu-bar item.
  app.on('activate', () => {
    if (windowCount() === 0) control.open()
  })

  app.on('will-quit', shutdown)

  return control
}
