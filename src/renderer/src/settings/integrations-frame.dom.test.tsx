// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { type MountedCapture, mountCapture } from '../capture/mount'
import { settingsCapture } from './capture/SettingsCapture'
import { ROW_MORE } from './IntegrationsTab'
import { LIST, ROW_BASE, ROW_TARGET, ROW_TEXT } from './mcp-parts'

/**
 * The Integrations tab against its frame (`uApL8`, T154). The design audit found the MCP-server and
 * Skill rows drawn as dark wells, 14px apart, taller than the frame and with a smaller transport
 * pill — each of them painted the other way with no test watching.
 *
 * The numbers were read off `integrations.css` until T210b; they are read off the class lists now,
 * which is where the same measurements live.
 */

/** The utilities one list writes, so a test can ask whether the frame's number is among them. */
function utilities(list: string): string[] {
  return list.split(/\s+/).filter(Boolean)
}

describe('the Integrations rows, read off the class lists', () => {
  it('fills a row with the card\u2019s own tone, not the page background', () => {
    expect(utilities(ROW_BASE)).toContain('bg-muted')
    expect(ROW_BASE).not.toContain('bg-background')
  })

  it('gives back the 1px border from the frame\u2019s 10px 12px padding, and centres the row', () => {
    expect(utilities(ROW_BASE)).toEqual(expect.arrayContaining(['px-11', 'py-9', 'items-center']))
  })

  it('stacks the rows 8px apart, with 3px between a row\u2019s two lines', () => {
    expect(utilities(LIST)).toContain('gap-8')
    expect(utilities(ROW_TEXT)).toContain('gap-3')
    // 15, the box `uApL8` draws the target in. At 14 every row was a pixel short of the frame's
    // 63 (a skill's 54) and the cards below them climbed three (T203b).
    expect(utilities(ROW_TARGET)).toContain('text-11-5/15')
  })

  it('lets the \u22ef button overhang the padding instead of pushing the glyph 5px further in', () => {
    expect(utilities(ROW_MORE)).toContain('-m-5')
  })
})

let mounted: MountedCapture
afterEach(() => mounted?.unmount())

describe('the Integrations tab, mounted on the frame’s fixture', () => {
  async function mount() {
    window.history.replaceState({}, '', '/settings-capture.html?tab=integrations')
    mounted = await mountCapture(settingsCapture)
    return mounted.host
  }

  it('keeps the rows in their own list, so they do not take the card’s 14px gap', async () => {
    const host = await mount()
    const rows = [...host.querySelectorAll('[data-ui="MCP server"], [data-ui="Skill"]')]

    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.parentElement?.className).toBe(LIST)
    }
  })

  it('puts the neutral kit Badge, dot and all, beside each server’s name', async () => {
    const host = await mount()
    const badges = [...host.querySelectorAll('[data-ui="MCP server"] [data-ui="Badge"]')]

    expect(badges.map((badge) => badge.textContent)).toEqual(['http', 'stdio', 'http'])
    for (const badge of badges) {
      expect(badge.getAttribute('data-variant') === 'neutral').toBe(true)
      expect(badge.querySelector('[data-slot=badge-dot]')).not.toBeNull()
    }
  })

  it('says who holds a skill the way the server rows do, by count', async () => {
    const host = await mount()
    const holders = [...host.querySelectorAll('[data-ui="Skill"] [data-ui="Holders"]')]

    expect(holders.map((line) => line.textContent)).toEqual(['4 employees', '2 employees', '1 employee'])
  })
})
