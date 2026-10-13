/**
 * The shell: the window's furniture and the screens mounted inside it.
 *
 * It is the renderer's composition root below `App.tsx` — the rail, the sidebar, the crash boundary,
 * the menu commands and `Views`, which names every screen there is. Everything here points up the
 * app, which is why the vocabulary a screen needs is `renderer/chrome` and not this (T202).
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { CompanyRail } from './CompanyRail'
export { installCrashHandlers } from './crash/report'
export { ScreenBoundary } from './crash/ScreenBoundary'
export { type MenuCommandDeps, runMenuCommand, ticketToReview } from './menu-commands'
export { SIDEBAR, Sidebar } from './Sidebar'
export { useCompanyAttention } from './use-company-attention'
export { useShellData } from './use-shell-data'
export { RouteView, viewHeading } from './Views'
