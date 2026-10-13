import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * Company settings → Environments, through the real screens (T218).
 *
 * The boss filled the Add variable modal in the packaged app, pressed Add variable, and landed on
 * the Office with nothing saved. No unit test could see it: the modal is a `<form>` inside the
 * settings screen's own `<form>`, and what that costs is a browser's form submission, which only
 * a browser does. So the two tests here are the boss's two ways of saying yes — the button and
 * Enter — and each one asserts the same three things: the app is still on Company settings, the
 * modal is gone, and the variable is in the table.
 */

const NAME = 'DATABASE_URL'
const VALUE = 'postgres://app:h7fs8@db.internal:5432/billing'

async function openTheEnvironmentsTab(page: import('@playwright/test').Page, company: string): Promise<void> {
  await page.getByRole('button', { name: 'Company settings' }).click()
  await expect(page).toHaveTitle(`${company} — Company settings`)
  await page.getByRole('tab', { name: 'Environments', exact: true }).click()
  await expect(page.locator('[data-ui="Environments"]')).toBeVisible()
}

/** The modal's own Add variable, not the toolbar's. */
const submit = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Add variable' })

test('adds a variable from the modal, and stays on Company settings', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')
  await openTheEnvironmentsTab(page, 'Testers Inc')

  await page.getByRole('button', { name: 'Add variable' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill(NAME)
  await page.getByRole('dialog').getByLabel('Value').fill(VALUE)
  await submit(page).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveTitle('Testers Inc — Company settings')
  await expect(page.locator('[data-ui="Environments"]')).toContainText(NAME)
  // The value reached the secret store and nothing draws it: the table shows dots.
  await expect(page.locator('[data-ui="Environments"]')).not.toContainText('postgres://')
  expect(tinycorp.takeErrors()).toEqual([])
})

test('adds a variable with Enter, and stays on Company settings', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')
  await openTheEnvironmentsTab(page, 'Testers Inc')

  await page.getByRole('button', { name: 'Add variable' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill(NAME)
  await page.getByRole('dialog').getByLabel('Value').fill(VALUE)
  await page.getByRole('dialog').getByLabel('Value').press('Enter')

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveTitle('Testers Inc — Company settings')
  await expect(page.locator('[data-ui="Environments"]')).toContainText(NAME)
  expect(tinycorp.takeErrors()).toEqual([])
})
