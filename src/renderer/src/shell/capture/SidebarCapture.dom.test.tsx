// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../../capture/mount'
import titleBarSource from '../../chrome/TitleBar.tsx?raw'
import * as fixture from './fixture'
import { RAIL_WIDTH, railCapture, SIDEBAR_HEIGHT, SIDEBAR_WIDTH, sidebarCapture } from './SidebarCapture'

/** The window every capture is shot at, which the design audit notes and each README name. */
const WINDOW_HEIGHT = 944

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

describe('the sidebar capture harness', () => {
  it('draws the sidebar, not an empty window', async () => {
    mounted = await mountCapture(sidebarCapture)

    expect(mounted.text).toContain(fixture.company.name)
    expect(mounted.text).toContain('Direct messages')
    expect(mounted.text).toContain('Company settings')
  })

  it('draws it inside the window the app gives it, which is what sets the face and the ink', async () => {
    mounted = await mountCapture(sidebarCapture)

    // Outside it the drawer inherits the platform's own font and the document's ink, and is
    // captured at the wrong value — an auditor then files a bug the app does not have.
    const drawer = mounted.host.querySelector('[data-ui="Company Drawer"]')
    expect(drawer).not.toBeNull()
    expect(drawer?.closest('.font-sans')).not.toBeNull()
  })

  it('draws it at the height the app gives it, so nothing that overflows is hidden', async () => {
    // The app's sidebar is the window less the title bar; a taller one leaves the nav room it
    // never has, and hides the overflow (T147). The bar's own class list is what decides its
    // height, and `--spacing` is the pixel, so `h-44` is 44.
    const titleBar = /^const BAR =\s*\n?\s*["']([^"']*)["']/m.exec(titleBarSource)?.[1] ?? ''
    const height = /\bh-(\d+)\b/.exec(titleBar)
    expect(height, titleBar).not.toBeNull()
    expect(SIDEBAR_HEIGHT).toBe(WINDOW_HEIGHT - Number(height?.[1]))

    mounted = await mountCapture(sidebarCapture)
    const shell = mounted.host.querySelector<HTMLElement>('[data-ui="Capture Window"]')
    expect(shell?.style.height).toBe(`${SIDEBAR_HEIGHT}px`)
    expect(shell?.style.width).toBe(`${SIDEBAR_WIDTH}px`)
  })
})

// T251: the rail's marks are measured against frame `u9sLao`, so the audit needs them on their own.
describe('the Company rail capture harness', () => {
  it('draws the frame’s four tiles: a one-digit badge, a two-digit one, working, and nothing', async () => {
    mounted = await mountCapture(railCapture)

    // The frame prints its second badge as `12`; the rail's own rule stops at `9+` so the pill
    // cannot outgrow a 40px tile (T145). Two characters either way, which is what the width is.
    const badges = [...mounted.host.querySelectorAll('[data-ui="Rail Badge"]')].map((el) => el.textContent)
    expect(badges).toEqual(['2', '9+'])
    expect(mounted.host.querySelectorAll('[data-ui="Rail Working"]')).toHaveLength(2)
    expect(mounted.host.querySelectorAll('[data-ui="Company Tile"]')).toHaveLength(fixture.railCompanies.length)
  })

  it('draws it at the width the window gives it, so the crop lines up with the frame', async () => {
    mounted = await mountCapture(railCapture)

    const shell = mounted.host.querySelector<HTMLElement>('[data-ui="Capture Window"]')
    expect(shell?.style.width).toBe(`${RAIL_WIDTH}px`)
    expect(shell?.style.height).toBe(`${fixture.RAIL_HEIGHT}px`)
  })
})
