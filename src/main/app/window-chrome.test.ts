import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TITLE_BAR_HEIGHT, TITLE_BAR_OVERLAY, WINDOW_CONTROLS_WIDTH, windowChrome } from './window-chrome'

/**
 * The window's frame was macOS's and only macOS's (T166): `titleBarStyle: 'hidden'` with nothing in
 * its place left a Windows window with no minimise, maximise or close button at all, and the
 * renderer went on holding 120px open on the left for traffic lights that were never drawn.
 */

const titleBar = readFileSync(join(import.meta.dirname, '../../renderer/src/chrome/TitleBar.tsx'), 'utf8')
const tokens = readFileSync(join(import.meta.dirname, '../../renderer/src/ui/tokens.css'), 'utf8')

describe('windowChrome', () => {
  it('keeps macOS’s traffic lights where the design puts them, and asks for no overlay', () => {
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { x: 15, y: 15 } })
  })

  it('gives Windows the overlay, so the window’s own three buttons exist', () => {
    const chrome = windowChrome('win32')

    expect(chrome.titleBarStyle).toBe('hidden')
    expect(chrome.trafficLightPosition).toBeUndefined()
    expect(chrome.titleBarOverlay).toEqual(TITLE_BAR_OVERLAY)
  })

  it('gives Linux the same overlay', () => {
    expect(windowChrome('linux').titleBarOverlay).toEqual(TITLE_BAR_OVERLAY)
  })

  it('draws the overlay in the design’s own colours, not the platform’s', () => {
    // Lowercased on both sides: `#1E293B` and `#1e293b` are the same colour, and which case the
    // stylesheet is written in is the formatter's business, not this test's (T183).
    const declared = tokens.toLowerCase()

    expect(declared).toContain(`--card: ${TITLE_BAR_OVERLAY.color.toLowerCase()};`)
    expect(declared).toContain(`--muted-foreground: ${TITLE_BAR_OVERLAY.symbolColor.toLowerCase()};`)
  })

  it('is exactly as tall as the bar the renderer draws', () => {
    // The bar is utilities since T210f, and `--spacing` is the pixel, so `h-44` is 44.
    const height = /\bh-(\d+)\b/.exec(bar())

    expect(Number(height?.[1])).toBe(TITLE_BAR_HEIGHT)
    expect(TITLE_BAR_OVERLAY.height).toBe(TITLE_BAR_HEIGHT)
  })
})

/** The bar's own class list, or the slot's, by the name it is declared under. */
const list = (name: string) => new RegExp(`^const ${name} =\\s*\\n?\\s*["']([^"']*)["']`, 'm').exec(titleBar)?.[1] ?? ''
const bar = () => list('BAR')

describe('the title bar the renderer draws', () => {
  it('drops the traffic lights’ slot where no traffic lights are drawn', () => {
    expect(list('LIGHTS')).toContain('in-[[data-platform=win32]]:hidden')
    expect(list('LIGHTS')).toContain('in-[[data-platform=linux]]:hidden')
  })

  it('keeps the overlay’s own width clear on the right instead', () => {
    const edge = Number(/\bpx-(\d+)\b/.exec(bar())?.[1])
    for (const platform of ['win32', 'linux']) {
      const margin = new RegExp(`in-\\[\\[data-platform=${platform}\\]\\]:mr-(\\d+)\\b`).exec(list('ACTIONS'))
      expect(edge + Number(margin?.[1])).toBe(WINDOW_CONTROLS_WIDTH)
    }
  })

  // A flex row centred the title between an empty left and a right end holding the actions and
  // the overlay, which drew it well left of the middle on Windows (T249's first real run).
  it('centres the title on the window, between two equal columns', () => {
    expect(bar()).toContain('grid-cols-[1fr_auto_1fr]')
    expect(bar()).not.toMatch(/data-platform=\w+\]\]:pr-/)
    expect(list('LIGHTS')).toContain('col-start-1')
    expect(list('TITLE')).toContain('col-start-2')
    expect(list('ACTIONS')).toContain('col-start-3')
  })
})
