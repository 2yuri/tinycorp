import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateTab,
  activeTab,
  closeActiveTab,
  closeTab,
  DEFAULT_ZOOM,
  NO_TABS,
  openTab,
  type TabsState,
  tabKey,
  updateTab,
} from './tabs-model'
import { forgetTabs, recallTabs, rememberTabs } from './tabs-store'

const PLACE = 'worktree:142:r-web'

function opened(...paths: string[]): TabsState {
  return paths.reduce((state, path) => openTab(state, { placeId: PLACE, path }), NO_TABS)
}

describe('The files the boss has open', () => {
  it('opens a file as a tab with its name, and shows it', () => {
    const state = openTab(NO_TABS, { placeId: PLACE, path: 'src/counter.ts', line: 19 })

    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({ placeId: PLACE, path: 'src/counter.ts', name: 'counter.ts', line: 19 })
    expect(activeTab(state)?.path).toBe('src/counter.ts')
  })

  it('goes to the tab a path already has rather than opening it twice', () => {
    const state = opened('src/counter.ts', 'README.md')

    const again = openTab(state, { placeId: PLACE, path: 'src/counter.ts' })

    expect(again.tabs.map((tab) => tab.path)).toEqual(['src/counter.ts', 'README.md'])
    expect(activeTab(again)?.path).toBe('src/counter.ts')
  })

  it('lands on the line the second click named, in the tab that was already open', () => {
    const state = openTab(opened('src/counter.ts'), { placeId: PLACE, path: 'src/counter.ts', line: 42 })

    expect(state.tabs).toHaveLength(1)
    expect(activeTab(state)?.line).toBe(42)
  })

  it('keeps the same path of two places apart', () => {
    const state = openTab(opened('README.md'), { placeId: 'repo:r-web', path: 'README.md' })

    expect(state.tabs).toHaveLength(2)
    expect(activeTab(state)?.placeId).toBe('repo:r-web')
  })

  it('opens a file from outside the Company under its whole path', () => {
    const shot = '/Users/yuri/shots/menu-portrait.png'
    const state = openTab(NO_TABS, { placeId: null, path: shot })

    expect(activeTab(state)).toMatchObject({ placeId: null, path: shot, name: 'menu-portrait.png' })
    expect(state.activeKey).toBe(tabKey(null, shot))
  })

  it('starts a sprite sheet pixel-true and a photograph smooth', () => {
    expect(openTab(NO_TABS, { placeId: PLACE, path: 'design/character-sheet.png' }).tabs[0]?.pixels).toBe(true)
    expect(openTab(NO_TABS, { placeId: PLACE, path: 'docs/photo.jpg' }).tabs[0]?.pixels).toBe(false)
  })
})

describe('Closing a tab', () => {
  it('shows the neighbour after the active one', () => {
    const state = activateTab(opened('a.ts', 'b.ts', 'c.ts'), tabKey(PLACE, 'b.ts'))

    const next = closeTab(state, tabKey(PLACE, 'b.ts'))

    expect(next.tabs.map((tab) => tab.path)).toEqual(['a.ts', 'c.ts'])
    expect(activeTab(next)?.path).toBe('c.ts')
  })

  it('falls back to the one before it when the active one was last', () => {
    const state = opened('a.ts', 'b.ts')

    expect(activeTab(closeTab(state, tabKey(PLACE, 'b.ts')))?.path).toBe('a.ts')
  })

  it('leaves the shown file alone when another tab is the one that closes', () => {
    const state = opened('a.ts', 'b.ts', 'c.ts')

    const next = closeTab(state, tabKey(PLACE, 'a.ts'))

    expect(activeTab(next)?.path).toBe('c.ts')
  })

  it('leaves nothing open when the last one closes', () => {
    const state = closeTab(opened('a.ts'), tabKey(PLACE, 'a.ts'))

    expect(state).toEqual(NO_TABS)
    expect(activeTab(state)).toBeNull()
  })

  it('closes the active one for ⌘W, and does nothing with none open', () => {
    expect(closeActiveTab(opened('a.ts', 'b.ts')).tabs.map((tab) => tab.path)).toEqual(['a.ts'])
    expect(closeActiveTab(NO_TABS)).toEqual(NO_TABS)
  })
})

describe('What a tab keeps to itself', () => {
  it('remembers an image tab’s zoom and pixel-true while it is open', () => {
    const key = tabKey(PLACE, 'sheet.png')
    const state = updateTab(opened('sheet.png', 'other.png'), key, { zoom: 4, pixels: false })

    expect(state.tabs.find((tab) => tab.key === key)).toMatchObject({ zoom: 4, pixels: false })
    expect(state.tabs[1]).toMatchObject({ zoom: DEFAULT_ZOOM })
  })

  it('opens an image fitted to the panel, which is what the boss sees first (T236)', () => {
    expect(DEFAULT_ZOOM).toBe('fit')
    expect(openTab(NO_TABS, { placeId: PLACE, path: 'shot.png' }).tabs[0]).toMatchObject({ zoom: 'fit' })
  })

  it('remembers the Markdown source toggle per tab', () => {
    const key = tabKey(PLACE, 'README.md')

    expect(updateTab(opened('README.md'), key, { source: true }).tabs[0]?.source).toBe(true)
  })
})

describe('Leaving Files and coming back', () => {
  beforeEach(forgetTabs)

  it('finds the tabs where they were, with the same one active', () => {
    const state = activateTab(opened('a.ts', 'b.ts'), tabKey(PLACE, 'a.ts'))

    rememberTabs('acme', state)

    expect(recallTabs('acme')).toEqual(state)
  })

  it('shows nothing of another Company’s, and nothing once the Company closes', () => {
    rememberTabs('acme', opened('a.ts'))

    expect(recallTabs('other')).toEqual(NO_TABS)

    forgetTabs()
    expect(recallTabs('acme')).toEqual(NO_TABS)
  })
})
