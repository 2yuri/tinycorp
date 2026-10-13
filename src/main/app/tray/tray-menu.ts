/**
 * What the menu-bar item holds (T117). Building the menu is kept apart from owning one, so the
 * rules — what it says, what it offers, what is greyed out — are tested without Electron.
 *
 * The shape is the subset of Electron's `MenuItemConstructorOptions` the item uses, so the adapter
 * in `menu-bar.ts` hands it straight to `Menu.buildFromTemplate`.
 */

import { APP_NAME } from '../../../shared/app/app-name'
import { type TraySummary, traySummaryLabel } from '../../../shared/app/tray'

export interface TrayMenuItem {
  label?: string
  type?: 'normal' | 'separator'
  enabled?: boolean
  click?: () => void
}

/** The same calls the app makes from the office header and the Launcher, made from the menu bar. */
export interface TrayActions {
  /** Reopens a Company: switches the engine to it and brings a window back. */
  open(companyId: string | null): void
  /** Pause all, exactly as the office header's button (decision 38). */
  pauseAll(): void
  resumeAll(): void
  /** Quit for real: every Session stops, as it does today. */
  quit(): void
}

const separator: TrayMenuItem = { type: 'separator' }

/**
 * The item's menu: what the floor is doing, the Companies to reopen, `Pause all` and `Quit`.
 *
 * The first row is the summary itself, greyed out — on macOS the item's own picture is all there is
 * until the menu is open, so the words have to live inside it.
 */
export function trayMenu(summary: TraySummary, actions: TrayActions): TrayMenuItem[] {
  return [
    { label: traySummaryLabel(summary), enabled: false },
    separator,
    ...openItems(summary, actions),
    separator,
    pauseItem(summary, actions),
    separator,
    { label: `Quit ${APP_NAME}`, click: actions.quit },
  ]
}

/** One row per Company the boss can reopen; with none known, the app itself. */
function openItems(summary: TraySummary, actions: TrayActions): TrayMenuItem[] {
  if (summary.companies.length === 0) return [{ label: `Open ${APP_NAME}`, click: () => actions.open(null) }]
  return summary.companies.map((company) => ({
    label: `Open ${company.name}`,
    click: () => actions.open(company.id),
  }))
}

/** `Pause all`, or `Resume all` while the Company is paused — the header's own button (decision 38). */
function pauseItem(summary: TraySummary, actions: TrayActions): TrayMenuItem {
  if (summary.paused) return { label: 'Resume all', click: actions.resumeAll }
  return { label: 'Pause all', enabled: summary.canPause, click: actions.pauseAll }
}
