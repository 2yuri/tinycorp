import { BrowserWindow } from 'electron'
import type { CapturePage } from '../../shared/testing'

/** How long a page gets to load before the shot is taken anyway. */
const LOAD_TIMEOUT_MS = 15_000

/** How long the page gets to paint after it has loaded. */
const SETTLE_MS = 400

/**
 * Loads the running app in a hidden, sandboxed window and returns what it painted (T174).
 *
 * It is its own window, off screen, with no node, no preload and nothing of the app's own session:
 * the page it loads is the boss's dev server, which is code the app has no business trusting. It is
 * closed in every path, loaded or not.
 */
export const capturePageInHiddenWindow: CapturePage = async ({ url, name }) => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  })
  try {
    await Promise.race([window.loadURL(url), new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS))])
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    const image = await window.webContents.capturePage()
    const data = image.toPNG()
    if (data.byteLength === 0) throw new Error(`Nothing was painted at ${url}`)
    return { name, data }
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
