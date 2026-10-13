/**
 * The window the screens sit in: where you are, how you get somewhere else, and what the
 * window itself is doing.
 *
 * It names nothing else in the renderer — the routes, the view header, the title bar, the host
 * platform and the close and leave requests are all leaves — which is why every screen may name it
 * and the shell, which mounts those screens, may not hold it (T202).
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { ContentHeader, ViewHeader } from './ContentHeader'
export {
  HEADER_ACTIONS,
  HEADER_INFO,
  HEADER_SPACER,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  HEADER_TITLE_ROW,
  SHELL,
  SHELL_BODY,
  SHELL_HEADER,
  SHELL_MAIN,
  SHELL_VIEW,
} from './chrome-style'
export { listenForCloseRequests, onCloseRequest } from './close-request'
export { hostPlatform, machineWordsHere, modifierLabel, shortcutLabel } from './host-platform'
export { onLeaveRequest, requestLeave } from './leave-guard'
export { navigate, onNavigate } from './navigate'
export {
  type BoardFilter,
  HOME,
  type Route,
  reviewWindowTitle,
  SETTINGS_TAB_LABEL,
  SETTINGS_TABS,
  type SettingsTab,
  sameRoute,
  testingWindowTitle,
  VIEW_LABEL,
  VIEWS,
  type ViewId,
  windowTitle,
} from './routes'
export { TitleBar } from './TitleBar'
