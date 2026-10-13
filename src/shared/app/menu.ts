/**
 * What the application menu asks the window to do (#223).
 *
 * The menu is built in the main process, but almost nothing in it is the main process's own work:
 * `Hire Employee…` is the office header's button, `Pause all` is the header's other button, `Board`
 * is a sidebar row. So the menu item sends the command here and the window does the very thing the
 * button does — one path, not two. Only the roles macOS owns (About, Hide, Quit, zoom, reload) and
 * the awake mode, which the main process holds, act without asking the window.
 */

/** A destination the Go menu reaches, in the order the menu lists it. */
export type MenuGoTarget =
  | 'office'
  | 'chat'
  | 'board'
  | 'repositories'
  | 'employees'
  | 'activity'
  /** The Review screen over whichever view is open (T82), on the ticket that has a diff waiting. */
  | 'review'
  /** The boss's Inbox in place of a channel's messages (decision 43). */
  | 'inbox'
  /** Your profile… and Company settings…, which sit apart from the sidebar tree. */
  | 'profile'
  | 'settings'

export type MenuCommand =
  | { kind: 'go'; target: MenuGoTarget }
  /** New Company…: the Launcher's Create step, as the Company rail's `+` opens it. */
  | { kind: 'new-company' }
  /** Open a Company…: the folder picker, then that folder's Company. */
  | { kind: 'open-company' }
  /** Open Recent: switch to a Company the boss has open or opened before. */
  | { kind: 'open-recent'; companyId: string }
  /** Move Company…: the current Company to another folder (decision 45). */
  | { kind: 'move-company' }
  /** Hire Employee…: the Employees view with the hire flow open. */
  | { kind: 'hire' }
  /** Pause all and Resume all, the office header's own button (decision 38). */
  | { kind: 'pause-all' }
  | { kind: 'resume-all' }
  /** Start, or stop, every Employee's Session: the Start and Stop buttons, pressed for everyone. */
  | { kind: 'start-every-session' }
  | { kind: 'stop-every-session' }
  /** The key to the floor, bottom left of the office canvas (T74). */
  | { kind: 'legend' }
