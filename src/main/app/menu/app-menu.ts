/**
 * What the application menu holds (#223). Building it is kept apart from owning one, exactly as the
 * menu-bar item's menu is (`tray/tray-menu.ts`), so the rules — what it says, what it offers, what
 * is greyed out — are tested without Electron.
 *
 * The shape is the subset of Electron's `MenuItemConstructorOptions` the menu uses, so the adapter
 * in `application-menu.ts` hands it straight to `Menu.buildFromTemplate`.
 */
import type { MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '../../../shared/app/app-name'
import { KEEP_AWAKE_MODES, type KeepAwakeMode, type KeepAwakeState } from '../../../shared/app/keep-awake'
import type { MenuCommand, MenuGoTarget } from '../../../shared/app/menu'

export interface AppMenuItem {
  label?: string
  /** A role macOS itself fills in: About, Hide, Quit, the zoom steps, Reload, the Window menu. */
  role?: MenuItemConstructorOptions['role']
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  accelerator?: string
  enabled?: boolean
  checked?: boolean
  submenu?: AppMenuItem[]
  click?: () => void
}

/** A Company in Open Recent. */
export interface MenuCompany {
  id: string
  name: string
  /** The one open now: it is ticked and cannot be opened again. */
  current: boolean
  /** Its folder is no longer on disk (T57), so the row is greyed rather than dropped. */
  missing: boolean
}

/** Everything the menu says about the app right now. A menu that lies about this is worse than none. */
export interface AppMenuState {
  /** The open Company's name, or null when none is open: Team and Go are greyed without one. */
  company: string | null
  /** Employees on staff: nobody to start a Session for greys the Session items. */
  employees: number
  /** Employees whose Session is not off — what `Pause all` and `Stop every Session` can act on. */
  running: number
  /** The boss paused the Company (decision 38), so `Pause all` reads `Resume all`. */
  paused: boolean
  /** The boss's awake mode and whether this platform has one at all (T99). */
  keepAwake: KeepAwakeState
  /** Open Recent, most recent first. */
  recents: MenuCompany[]
  /** macOS gets the app menu; elsewhere its items move into File and Help. */
  mac: boolean
}

/** Everything a menu item does. Nothing here reaches into the engine or the window itself. */
export interface AppMenuActions {
  /** The window does what the boss's own button does (#223). */
  send(command: MenuCommand): void
  /** `⌘W`: the view the boss is in closes what it has open first (T121). */
  closeCompany(): void
  /** The awake mode, set where the coffee cup sets it (T99). */
  setKeepAwakeMode(mode: KeepAwakeMode): void
  /** The repo, in the system browser. */
  openRepo(): void
}

const separator: AppMenuItem = { type: 'separator' }

/** The Go menu, and the keys it answers to. The Review screen and the Inbox are destinations too. */
const GO: { target: MenuGoTarget; label: string; accelerator: string }[] = [
  { target: 'office', label: 'Office', accelerator: 'CmdOrCtrl+1' },
  { target: 'chat', label: 'Chat', accelerator: 'CmdOrCtrl+2' },
  { target: 'board', label: 'Board', accelerator: 'CmdOrCtrl+3' },
  { target: 'repositories', label: 'Repositories', accelerator: 'CmdOrCtrl+4' },
  { target: 'employees', label: 'Employees', accelerator: 'CmdOrCtrl+5' },
  { target: 'activity', label: 'Activity', accelerator: 'CmdOrCtrl+6' },
  { target: 'review', label: 'Review', accelerator: 'CmdOrCtrl+7' },
  { target: 'inbox', label: 'Inbox', accelerator: 'CmdOrCtrl+0' },
]

/**
 * The whole menu: the app's own items, the Companies, the team, the views, and the roles macOS
 * fills in. Every item that acts on a Company is greyed while none is open, rather than missing,
 * so the menu is the same shape whatever the app is doing.
 */
export function appMenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    ...(state.mac ? [{ label: APP_NAME, submenu: appSubmenu(state, actions) }] : []),
    { label: 'File', submenu: fileSubmenu(state, actions) },
    { role: 'editMenu' },
    { label: 'Team', submenu: teamSubmenu(state, actions) },
    { label: 'Go', submenu: goSubmenu(state, actions) },
    { label: 'View', submenu: viewSubmenu(state, actions) },
    { role: 'windowMenu' },
    { role: 'help', submenu: helpSubmenu(state, actions) },
  ]
}

/** The app's own menu: who the boss is, how the app behaves, and the roles macOS owns. */
function appSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    { role: 'about', label: `About ${APP_NAME}` },
    separator,
    ...bossItems(state, actions),
    ...keepAwakeItems(state, actions),
    { role: 'hide', label: `Hide ${APP_NAME}` },
    { role: 'hideOthers' },
    { role: 'unhide' },
    separator,
    { role: 'quit', label: `Quit ${APP_NAME}` },
  ]
}

/** Your profile… and Company settings…, in the app menu on macOS and at the foot of File elsewhere. */
function bossItems(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    { label: 'Your profile…', click: () => actions.send({ kind: 'go', target: 'profile' }) },
    {
      label: 'Company settings…',
      accelerator: 'CmdOrCtrl+,',
      enabled: state.company !== null,
      click: () => actions.send({ kind: 'go', target: 'settings' }),
    },
    separator,
  ]
}

/**
 * `Keep this Mac awake`, the coffee cup's own three modes with the live one ticked (T99). Nothing
 * at all on a platform that has no assertion to hold, which is where the cup does not appear either.
 */
function keepAwakeItems(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  if (!state.keepAwake.supported) return []
  return [
    {
      label: 'Keep this Mac awake',
      submenu: KEEP_AWAKE_MODES.map(({ mode, title }) => ({
        label: title,
        type: 'radio' as const,
        checked: state.keepAwake.mode === mode,
        click: () => actions.setKeepAwakeMode(mode),
      })),
    },
    separator,
  ]
}

/** The Companies: a new one, one on disk, one from before, and the one open now. */
function fileSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    { label: 'New Company…', accelerator: 'CmdOrCtrl+N', click: () => actions.send({ kind: 'new-company' }) },
    { label: 'Open a Company…', accelerator: 'CmdOrCtrl+O', click: () => actions.send({ kind: 'open-company' }) },
    { label: 'Open Recent', enabled: state.recents.length > 0, submenu: recentItems(state, actions) },
    separator,
    {
      label: 'Close Company',
      accelerator: 'CmdOrCtrl+W',
      enabled: state.company !== null,
      click: actions.closeCompany,
    },
    { label: 'Move Company…', enabled: state.company !== null, click: () => actions.send({ kind: 'move-company' }) },
    // The app menu holds these on macOS; elsewhere File is where a boss looks for them.
    ...(state.mac ? [] : [separator, ...bossItems(state, actions), { role: 'quit' as const }]),
  ]
}

/** Every Company the boss can go back to, most recent first; the one open now is ticked. */
function recentItems(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  if (state.recents.length === 0) return [{ label: 'Nothing yet', enabled: false }]
  return state.recents.map((company) => ({
    label: company.name,
    type: 'checkbox' as const,
    checked: company.current,
    // A folder that is gone opens nothing (T57), and the Company already open is already open.
    enabled: !company.missing && !company.current,
    click: () => actions.send({ kind: 'open-recent', companyId: company.id }),
  }))
}

/** Hiring, and the Sessions of everyone already hired. */
function teamSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  const open = state.company !== null
  return [
    {
      label: 'Hire Employee…',
      accelerator: 'CmdOrCtrl+Shift+H',
      enabled: open,
      click: () => actions.send({ kind: 'hire' }),
    },
    separator,
    pauseItem(state, actions),
    {
      label: 'Start every Session',
      // While paused, `start` refuses: Resume all is the way back (decision 38).
      enabled: open && !state.paused && state.running < state.employees,
      click: () => actions.send({ kind: 'start-every-session' }),
    },
    {
      label: 'Stop every Session',
      enabled: open && state.running > 0,
      click: () => actions.send({ kind: 'stop-every-session' }),
    },
  ]
}

/** `Pause all`, or `Resume all` while the Company is paused — the office header's own button. */
function pauseItem(state: AppMenuState, actions: AppMenuActions): AppMenuItem {
  if (state.paused) {
    return { label: 'Resume all', accelerator: 'CmdOrCtrl+Shift+P', click: () => actions.send({ kind: 'resume-all' }) }
  }
  return {
    label: 'Pause all',
    accelerator: 'CmdOrCtrl+Shift+P',
    enabled: state.company !== null && state.running > 0,
    click: () => actions.send({ kind: 'pause-all' }),
  }
}

/** The sidebar's own destinations, by key. Greyed with no Company, because they have nothing to show. */
function goSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return GO.map(({ target, label, accelerator }) => ({
    label,
    accelerator,
    enabled: state.company !== null,
    click: () => actions.send({ kind: 'go', target }),
  }))
}

/** The window, the floor's key, the text size, and the two the boss only wants when something broke. */
function viewSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    { role: 'togglefullscreen', label: 'Full screen' },
    { label: 'Legend', enabled: state.company !== null, click: () => actions.send({ kind: 'legend' }) },
    separator,
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { role: 'resetZoom' },
    separator,
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
  ]
}

/** The repo, and About where macOS does not already have it. */
function helpSubmenu(state: AppMenuState, actions: AppMenuActions): AppMenuItem[] {
  return [
    { label: `${APP_NAME} on GitHub`, click: actions.openRepo },
    ...(state.mac ? [] : [separator, { role: 'about' as const, label: `About ${APP_NAME}` }]),
  ]
}
