/**
 * The application menu itself (#223): it reads the engine, says what the app can do right now, and
 * is rebuilt the moment that changes — a Company opening, an Employee hired, everything paused, the
 * awake mode switched.
 *
 * It never reaches into the engine from an item: every item that stands for a button in the window
 * sends that button's own command (`shared/menu.ts`), and the window does the one thing it already
 * does. The engine is only read here, exactly as the menu-bar item reads it (`tray/menu-bar.ts`).
 */
import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { KeepAwakeState } from '../../../shared/app/keep-awake'
import type { MenuCommand } from '../../../shared/app/menu'
import { byRecency } from '../../../shared/company'
import { shellChannels } from '../../../shared/domain/channels'
import type { CompanyEngine } from '../../core/engine'
import { type AppMenuActions, type AppMenuItem, type AppMenuState, appMenu, type MenuCompany } from './app-menu'

/** What the menu says of the app, apart from the recents, which are read less often. */
export type MenuFacts = Omit<AppMenuState, 'recents'>

/** The bit of Electron the menu uses. */
export interface MenuHost {
  set(items: AppMenuItem[]): void
}

export interface ApplicationMenuOptions {
  host: MenuHost
  /** The engine as the menu reads it. Cheap: no Company folder is opened.  */
  facts(): MenuFacts
  /**
   * Open Recent. Read only when the known Companies change, because it reads every Company's
   * folder: a Session status changing must not open a database.
   */
  recents(): MenuCompany[]
  actions: AppMenuActions
  /** Subscribes to whatever changes what the menu says. Returns an unsubscribe function. */
  watch(options: { refresh(): void; refreshCompanies(): void }): () => void
}

export interface ApplicationMenu {
  /** The items the menu holds now, for the tests and for whoever wants to know. */
  items(): AppMenuItem[]
  /** Reads the engine again and rebuilds. */
  refresh(): void
  /** The known Companies changed: Open Recent is read again too. */
  refreshCompanies(): void
  close(): void
}

export function createApplicationMenu({
  host,
  facts,
  recents,
  actions,
  watch,
}: ApplicationMenuOptions): ApplicationMenu {
  let known = recents()
  let items = appMenu({ ...facts(), recents: known }, actions)
  let stop = () => {}

  function draw(): void {
    items = appMenu({ ...facts(), recents: known }, actions)
    host.set(items)
  }

  const menu: ApplicationMenu = {
    items: () => items,
    refresh: draw,
    refreshCompanies() {
      known = recents()
      draw()
    },
    close() {
      stop()
    },
  }

  host.set(items)
  stop = watch({ refresh: menu.refresh, refreshCompanies: menu.refreshCompanies })
  return menu
}

/** The real menu bar: the template goes straight to Electron, which is why it is that shape. */
export function electronMenuHost(): MenuHost {
  return {
    set(items) {
      Menu.setApplicationMenu(Menu.buildFromTemplate(items as MenuItemConstructorOptions[]))
    },
  }
}

/**
 * The engine as the menu reads it: the open Company, how many Employees it has, how many Sessions
 * are not off, and whether it is paused. A Company that is being switched reads as none open
 * rather than throwing: a menu is never worth taking the app down for.
 */
export function engineMenuFacts(
  engine: CompanyEngine,
  keepAwake: KeepAwakeState,
  platform: NodeJS.Platform = process.platform,
): MenuFacts {
  const mac = platform === 'darwin'
  try {
    const open = engine.currentCompany()
    if (!open) return { company: null, employees: 0, running: 0, paused: false, keepAwake, mac }
    return {
      company: open.name,
      employees: engine.employees.list().length,
      running: engine.sessions.list().filter((session) => session.status !== 'off').length,
      paused: engine.sessions.paused(),
      keepAwake,
      mac,
    }
  } catch {
    return { company: null, employees: 0, running: 0, paused: false, keepAwake, mac }
  }
}

/** Open Recent: every Company the boss can go back to, in the Launcher's own order. */
export function engineMenuRecents(engine: CompanyEngine): MenuCompany[] {
  try {
    return byRecency(engine.companySummaries()).map((summary) => ({
      id: summary.id,
      name: summary.name,
      current: summary.current,
      missing: summary.missing,
    }))
  } catch {
    return []
  }
}

/**
 * Everything that changes what the menu says: the Company in use, the staff, the Sessions. The
 * awake mode is not here — the main process announces that itself, where it is set (T99).
 */
export function watchMenuEngine(engine: CompanyEngine): ApplicationMenuOptions['watch'] {
  return ({ refresh, refreshCompanies }) => {
    const stops = [
      // A Company opened, closed, switched, created or forgotten: Open Recent changes with it.
      engine.onChange(refreshCompanies),
      engine.employees.onChange(refresh),
      engine.sessions.onChange(refresh),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }
}

/**
 * The window a menu command goes to. The menu belongs to the app rather than to a window, so
 * `windowOf` is the one way back in (T117): with the app in the menu bar and no window at all,
 * `New Company…` opens one and the command waits for it to finish loading.
 */
export function sendToWindow(windowOf: () => BrowserWindow): (command: MenuCommand) => void {
  return (command) => {
    const window = windowOf()
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => window.webContents.send(shellChannels.menuCommand, command))
      return
    }
    window.webContents.send(shellChannels.menuCommand, command)
  }
}
