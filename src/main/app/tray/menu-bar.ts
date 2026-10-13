/**
 * The menu-bar item itself (T117): it reads the engine, says what the floor is doing, and offers
 * the boss the way back in.
 *
 * It never reaches into the engine: it is handed a reading of it and the calls to make, the same
 * calls the renderer makes over the IPC contract. The day the engine moves into a process of its
 * own, `engineTrayFacts` becomes one request and nothing else here changes.
 */
import { type TrayFacts, type TraySummary, traySummary, trayTooltip } from '../../../shared/app/tray'
import type { CompanyEngine } from '../../core/engine'
import { type TrayActions, type TrayMenuItem, trayMenu } from './tray-menu'

/** The bit of Electron's `Tray` the item uses. */
export interface MenuBarItem {
  setToolTip(text: string): void
  setContextMenu(menu: TrayMenuItem[]): void
  destroy(): void
}

export interface MenuBarOptions {
  item: MenuBarItem
  /** The engine's own reading of the floor, read again on every change. */
  facts(): TrayFacts
  actions: TrayActions
  /** Subscribes to whatever moves the floor. Returns an unsubscribe function. */
  watch(refresh: () => void): () => void
}

export interface MenuBar {
  /** What the item says now, for the tests and for whoever wants to know. */
  summary(): TraySummary
  /** Reads the engine again and redraws the menu. */
  refresh(): void
  close(): void
}

export function createMenuBar({ item, facts, actions, watch }: MenuBarOptions): MenuBar {
  let current = traySummary(facts())

  function draw(): void {
    item.setToolTip(trayTooltip(current))
    item.setContextMenu(trayMenu(current, actions))
  }

  const refresh = () => {
    current = traySummary(facts())
    draw()
  }

  draw()
  const stop = watch(refresh)

  return {
    summary: () => current,
    refresh,
    close() {
      stop()
      item.destroy()
    },
  }
}

/**
 * The engine as the menu bar reads it: the open Company's Sessions and undecided Approvals, the
 * app-wide budget, and every Company the boss can reopen — the current one first.
 */
export function engineTrayFacts(engine: CompanyEngine): TrayFacts {
  const open = engine.currentCompany()
  const known = engine.listCompanies().map((company) => ({
    id: company.id,
    name: company.name,
    current: company.id === open?.id,
  }))
  const companies = [...known].sort((a, b) => Number(b.current) - Number(a.current))
  const outOfBudget = engine.capacity.usage().budget !== null
  if (!open) return { sessions: {}, pendingRequesterIds: [], askingIds: [], outOfBudget, paused: false, companies }
  const sessions = engine.sessions.list()
  return {
    sessions: Object.fromEntries(sessions.map((session) => [session.employeeId, session.status])),
    // A Session stopped in its terminal to ask is waiting on the boss, and the item says so (T165).
    askingIds: sessions.flatMap((session) => (session.asking ? [session.employeeId] : [])),
    pendingRequesterIds: engine.approvals.list({ status: 'pending' }).map((approval) => approval.requesterId),
    outOfBudget,
    paused: engine.sessions.paused(),
    companies,
  }
}

/** Everything that moves the floor the item is standing in for. */
export function watchEngine(engine: CompanyEngine): (refresh: () => void) => () => void {
  return (refresh) => {
    const stops = [
      engine.onChange(refresh),
      engine.sessions.onChange(refresh),
      engine.approvals.onChange(refresh),
      engine.capacity.onChange(refresh),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }
}
