/**
 * The real menu-bar item: Electron's `Tray`, wrapped in the small surface `menu-bar.ts` asks for.
 * The rest of the tray knows nothing about Electron, which is what lets it be tested (T117).
 *
 * The three platforms give it three different homes and the same job: the macOS menu bar, the
 * Windows notification area, and — on Linux — an AppIndicator, where the desktop has one. GNOME
 * has not shipped a tray of its own since 3.26, so a plain GNOME session has none unless the boss
 * installed the AppIndicator extension, and KDE, Cinnamon, XFCE and Budgie all do.
 *
 * Where there is none, `new Tray(...)` throws and this answers null — **quietly**, which is the
 * whole point: the caller then quits on the last window rather than leaving a process nobody can
 * see or get back to (`background.ts`). Nothing is said to the boss about a tray they did not ask
 * for and cannot have.
 *
 * A Linux tray has one more rule: the menu **is** the item. Clicks on an AppIndicator are not
 * delivered to the app at all, so anything the item can do has to be in the context menu — which
 * it is: `menu-bar.ts` has never had a click handler, only `setContextMenu`.
 */
import { Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../../../shared/app/app-name'
import { appIconPath } from '../app-identity'
import type { MenuBarItem } from './menu-bar'

/** The points macOS gives an item's picture in the menu bar, and close enough for the other two. */
const ITEM_POINTS = 18

/** Two device pixels per point, so the mark is not soft on a Retina display. */
const ITEM_SCALE = 2

/**
 * Creates the item, or null where the platform has no tray or it could not be created. Without one
 * there is no way back into a windowless app, so the caller quits on the last window instead.
 */
export function createElectronMenuBarItem(): MenuBarItem | null {
  const mark = itemMark()
  if (!mark) return null
  try {
    const tray = new Tray(mark)
    tray.setToolTip(APP_NAME)
    return {
      setToolTip: (text) => tray.setToolTip(text),
      setContextMenu: (menu) => tray.setContextMenu(Menu.buildFromTemplate(menu)),
      destroy: () => tray.destroy(),
    }
  } catch {
    return null
  }
}

/** The app's own mark at the size the menu bar draws it, or null when there is no mark to draw. */
function itemMark(): Electron.NativeImage | null {
  const icon = nativeImage.createFromPath(appIconPath())
  if (icon.isEmpty()) return null
  const drawn = icon.resize({ width: ITEM_POINTS * ITEM_SCALE, height: ITEM_POINTS * ITEM_SCALE })
  return nativeImage.createFromBuffer(drawn.toPNG(), { scaleFactor: ITEM_SCALE })
}
