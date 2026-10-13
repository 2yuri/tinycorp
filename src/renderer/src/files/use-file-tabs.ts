/**
 * The files the boss has open, as tabs (T121): the state `tabs-model.ts` computes, the store that
 * holds it while the view is unmounted, and the one subscription that turns a path clicked anywhere
 * else into a tab.
 *
 * `current()` is how a handler installed once — ⌘S, ⌘W, the leave guard — reads what is open
 * without holding a tab that has since closed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { onNavigate } from '../chrome'
import {
  activateTab,
  activeTab,
  closeTab,
  type FileTab,
  openTab,
  type TabRequest,
  type TabsState,
  type TabView,
  updateTab,
} from './tabs-model'
import { recallTabs, rememberTabs } from './tabs-store'

export interface FileTabs {
  state: TabsState
  /** The tab the viewer shows, or null when nothing is open. */
  shown: FileTab | null
  /** What is open right now, read by a handler that was installed once. */
  current(): TabsState
  open(request: TabRequest): void
  activate(key: string): void
  close(key: string): void
  update(key: string, view: Partial<TabView>): void
}

export interface FileTabsWatch {
  /** The Company the tabs belong to; another Company's are never shown, and closing one drops them. */
  companyId: string | null
  /** The place the tree is on, which a route with a path and no place opens in. */
  placeId: string | undefined
  /** A route that names another place — a link to a file of another repo — switches the tree to it. */
  onPlace(placeId: string): void
}

export function useFileTabs({ companyId, placeId, onPlace }: FileTabsWatch): FileTabs {
  // The tabs come back as they were left: leaving Files unmounts the view, not what is open in it.
  const [state, setState] = useState<TabsState>(() => recallTabs(companyId))
  // The latest of both, so the subscription below is installed once and still never stale.
  const held = useRef(state)
  held.current = state
  const watching = useRef({ placeId, onPlace })
  watching.current = { placeId, onPlace }

  useEffect(() => {
    rememberTabs(companyId, state)
  }, [companyId, state])

  // While the view is open, every path clicked anywhere else adds its tab — the same path twice
  // goes to the tab that already has it, which a route prop alone could not tell apart.
  useEffect(
    () =>
      onNavigate((route) => {
        if (route.view !== 'files') return
        const line = route.line ?? null
        if (route.outside !== undefined) {
          const outside = route.outside
          return setState((was) => openTab(was, { placeId: null, path: outside, line }))
        }
        if (route.placeId !== undefined) watching.current.onPlace(route.placeId)
        const where = route.placeId ?? watching.current.placeId
        const path = route.path
        if (path === undefined || where === undefined) return
        setState((was) => openTab(was, { placeId: where, path, line }))
      }),
    [],
  )

  return {
    state,
    shown: activeTab(state),
    current: useCallback(() => held.current, []),
    open: useCallback((request) => setState((was) => openTab(was, request)), []),
    activate: useCallback((key) => setState((was) => activateTab(was, key)), []),
    close: useCallback((key) => setState((was) => closeTab(was, key)), []),
    update: useCallback((key, view) => setState((was) => updateTab(was, key, view)), []),
  }
}
