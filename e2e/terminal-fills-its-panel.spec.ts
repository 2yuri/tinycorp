import type { Page } from '@playwright/test'
import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * The Employee drawer's terminal, at two window heights, through the real screens (TI-3).
 *
 * The terminal stayed 24 rows tall whatever the drawer was: 384px of xterm in a 632px panel, and
 * still 384px once the window was short enough that the panel was 328px — running under the
 * footer. What xterm then told the Session was those 24 rows, so an agent whose PTY was spawned
 * taller pushed its input box and status line past the last row, where they arrived as stray
 * numbers.
 *
 * Neither half is visible to a unit test: jsdom lays nothing out, so `live-terminal.dom.test.tsx`
 * can only stand the fit in and watch what is sent. Nor can a capture state, which shoots one
 * height. It takes a browser laying the drawer out at two, which is this.
 */

const NAME = 'Vega'

/** Hires one Employee, so the Employees screen has a card whose drawer can be opened. */
async function hire(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Employees', exact: true }).click()
  await page.getByRole('button', { name: 'Hire Employee' }).first().click()
  const modal = page.getByRole('dialog', { name: 'Hire an employee' })
  await modal.locator('input[data-ui="Name"]').fill(name)
  await modal.getByRole('button', { name: `Hire ${name}` }).click()
  await expect(page.getByRole('dialog', { name: 'Hire an employee' })).toHaveCount(0)
  await expect(page.locator('[data-employee]')).toHaveCount(1)
}

/** The terminal panel, and the box xterm draws into: how tall each one really is. */
async function boxes(page: Page): Promise<{ panel: number; box: number }> {
  const panel = page.getByTestId('live-terminal')
  // The div xterm was opened into, named by what it holds: `SCREEN` writes no hook of its own.
  const box = panel.locator('div:has(> .xterm)')
  return {
    panel: await panel.evaluate((element) => element.clientHeight),
    box: await box.evaluate((element) => element.clientHeight),
  }
}

/**
 * What the panel has left over once the box is in it: its own padding, and nothing else. The fit
 * is debounced and the web font arrives on its own, so this is polled rather than read once.
 */
async function spareHeight(page: Page): Promise<number> {
  let last = { panel: 0, box: 0 }
  await expect
    .poll(async () => {
      last = await boxes(page)
      return last.panel > 0 && last.box > 0
    })
    .toBe(true)
  return last.panel - last.box
}

test('the drawer’s terminal fills its panel, and shrinks with the window', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')
  await hire(page, NAME)

  await page.locator('[data-employee]').click()
  await expect(page.locator('[data-testid="live-terminal"] .xterm-screen')).toBeAttached()

  // Room for the panel's padding, and for a row xterm could not fit — never for a whole band.
  await expect.poll(() => spareHeight(page)).toBeLessThan(40)

  const tall = await boxes(page)
  await page.setViewportSize({ width: 1280, height: 640 })
  await expect.poll(() => spareHeight(page)).toBeLessThan(40)

  const short = await boxes(page)
  expect(short.panel).toBeLessThan(tall.panel)
  // The box came down with the panel rather than running past the bottom of it.
  expect(short.box).toBeLessThan(tall.box)
  expect(tinycorp.takeErrors()).toEqual([])
})
