import { SETTINGS_TAB_LABEL, SETTINGS_TABS } from '../src/renderer/src/chrome/routes'
import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * Company settings, every tab (T189).
 *
 * Each tab is a screen that reads the engine over the IPC contract the moment it is drawn, and a
 * tab whose first read throws draws its empty shape and says nothing — which is the failure the
 * unit tests cannot see, because they hand each tab its data. This opens all six against a real
 * engine and a real, empty Company, and fails on anything the renderer wrote to the console.
 *
 * The tabs are read from `SETTINGS_TABS` rather than listed here: a seventh tab is covered the day
 * it exists, and a tab that is renamed does not quietly stop being opened.
 */
test('opens every Company settings tab without a console error', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')

  await page.getByRole('button', { name: 'Company settings' }).click()
  await expect(page).toHaveTitle('Testers Inc — Company settings')

  for (const tab of SETTINGS_TABS) {
    const label = SETTINGS_TAB_LABEL[tab]
    await page.getByRole('tab', { name: label, exact: true }).click()
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')
    // The tab drew something of its own, rather than leaving the tab strip over an empty panel.
    await expect(page.locator('[data-ui="Company Settings"]').getByRole('heading').first()).toBeVisible()
    expect(tinycorp.takeErrors(), `${label} wrote to the console`).toEqual([])
  }
})
