/**
 * The files the boss has open, as tabs (T121). A click on a path adds one; the same path twice
 * goes to the tab that already has it. Pure: the view hands a state in and gets the next one back.
 */
import { looksLikeSprite, nameOf } from './files-model'

/**
 * How an image is drawn: fitted to the panel it is in, or at a whole multiple of its own pixels.
 * `fit` only ever shrinks — an image smaller than the panel is drawn at its own size, not blown up
 * — so the fitted view of a sprite sheet and its `1×` are the same picture.
 */
export type ImageZoom = 'fit' | number

/** What an image tab opens at, and comes back to between visits. */
export const DEFAULT_ZOOM: ImageZoom = 'fit'

/** One file open in the Files view. */
export interface FileTab {
  /** What makes two tabs the same file; see `tabKey`. */
  key: string
  /** The place the file is in, or null for one from outside the Company. */
  placeId: string | null
  /** Relative to the place, or the absolute path for a file from outside. */
  path: string
  /** What the tab says: the file's name. */
  name: string
  /** The line a path written elsewhere named (T114); null when nobody named one. */
  line: number | null
  /** Markdown only: whether the source shows in place of the rendering. */
  source: boolean
  /** An image tab's own zoom, kept while it is open. */
  zoom: ImageZoom
  /** An image tab's own `Pixel-true`; a sprite sheet starts on. */
  pixels: boolean
}

/** Every open file, and which one the viewer shows. */
export interface TabsState {
  tabs: FileTab[]
  /** The key of the tab the viewer shows; null when nothing is open. */
  activeKey: string | null
}

/** Nothing open: what the view starts on, and what closing the last tab comes back to. */
export const NO_TABS: TabsState = { tabs: [], activeKey: null }

/** What the boss asked to open: a file of a place, or one from anywhere on the machine. */
export interface TabRequest {
  /** Null for a file outside the Company. */
  placeId: string | null
  path: string
  line?: number | null
}

/** Two tabs are the same file when they are the same path of the same place. */
export function tabKey(placeId: string | null, path: string): string {
  return placeId === null ? `outside:${path}` : `place:${placeId}:${path}`
}

/** The tab the viewer shows, or null when nothing is open. */
export function activeTab(state: TabsState): FileTab | null {
  return state.tabs.find((tab) => tab.key === state.activeKey) ?? null
}

/**
 * Opening a file: a new tab at the end, or the tab that already has it, which is what a second
 * click on the same path comes to. A line named this time replaces the one the tab was opened at.
 */
export function openTab(state: TabsState, request: TabRequest): TabsState {
  const key = tabKey(request.placeId, request.path)
  const line = request.line ?? null
  const known = state.tabs.find((tab) => tab.key === key)
  if (known) {
    const tabs = line === null ? state.tabs : state.tabs.map((tab) => (tab.key === key ? { ...tab, line } : tab))
    return { tabs, activeKey: key }
  }
  const tab: FileTab = {
    key,
    placeId: request.placeId,
    path: request.path,
    name: nameOf(request.path),
    line,
    source: false,
    zoom: DEFAULT_ZOOM,
    pixels: looksLikeSprite(request.path),
  }
  return { tabs: [...state.tabs, tab], activeKey: key }
}

/** Clicking a tab. A key nothing is open under leaves the state alone. */
export function activateTab(state: TabsState, key: string): TabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state
  return { ...state, activeKey: key }
}

/**
 * Closing a tab — its `×`, or a middle click on it. Closing the active one shows its neighbour:
 * the tab after it, or the one before it when it was last. Closing the last leaves nothing open.
 */
export function closeTab(state: TabsState, key: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.key === key)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.key !== key)
  if (state.activeKey !== key) return { tabs, activeKey: state.activeKey }
  const neighbour = tabs[index] ?? tabs[index - 1] ?? null
  return { tabs, activeKey: neighbour?.key ?? null }
}

/** `⌘W` with Files in front: the active tab goes. With none open there is nothing to close. */
export function closeActiveTab(state: TabsState): TabsState {
  return state.activeKey === null ? state : closeTab(state, state.activeKey)
}

/** What a tab keeps to itself while it is open: the Markdown toggle, an image's zoom and pixels. */
export type TabView = Pick<FileTab, 'source' | 'zoom' | 'pixels'>

/** The boss zoomed an image, or asked Markdown for its source: the tab remembers it. */
export function updateTab(state: TabsState, key: string, view: Partial<TabView>): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, ...view } : tab)) }
}
