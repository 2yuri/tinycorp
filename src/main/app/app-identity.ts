import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import { APP_ID, APP_NAME } from '../../shared/app/app-name'

/** What the app calls itself in the Dock, the app switcher and the menu bar. */
export { APP_ID, APP_NAME }

/** The 1024px mark in `resources/`, packaged beside the built main process. */
export function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(import.meta.dirname, '../../resources/icon.png')
}

/**
 * Names the app and gives it its icon before any window exists, so `cmd+tab`, the Dock and the
 * menu bar show TinyCorp rather than Electron. Packaged builds take both from the bundle, but the
 * Dock icon still has to be set by hand in development.
 */
export function applyAppIdentity(): void {
  app.setName(APP_NAME)
  // The identity notifications are granted against: the bundle id on macOS, this on Windows (T126).
  app.setAppUserModelId(APP_ID)
  const icon = nativeImage.createFromPath(appIconPath())
  if (!icon.isEmpty() && process.platform === 'darwin' && app.dock) app.dock.setIcon(icon)
}
