import type { Page } from '@playwright/test'
import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * The Employee card's menu, through the real screens (T223).
 *
 * The boss pressed Edit in the packaged app and nothing happened — nor did anything happen for any
 * other row of the menu, and the menu could not be closed either. No unit test could see it: the
 * card is one big button with its content over it, everything but that button is
 * `pointer-events: none`, and the menu's exception to that lost a tie on emission order when
 * `employees.css` became utilities. What that costs is a browser's hit testing, which only a browser
 * does, so the three symptoms are three assertions here — Edit opens the modal, Escape closes the
 * menu, and a press outside closes it.
 */

const NAME = 'Vega'

/** Hires one Employee, so the Team screen has a card with a menu on it. */
async function hire(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Employees', exact: true }).click()
  await page.getByRole('button', { name: 'Hire Employee' }).first().click()
  const modal = page.getByRole('dialog', { name: 'Hire an employee' })
  await modal.locator('input[data-ui="Name"]').fill(name)
  await modal.getByRole('button', { name: `Hire ${name}` }).click()
  await expect(page.getByRole('dialog', { name: 'Hire an employee' })).toHaveCount(0)
  await expect(page.locator('[data-employee]')).toHaveCount(1)
}

const cardMenu = (page: Page) => page.locator('[data-employee] [data-card="menu"]')

async function openTheCardMenu(page: Page): Promise<void> {
  await page.locator('[data-employee]').hover()
  await page.getByRole('button', { name: `More for ${NAME}` }).click()
  await expect(cardMenu(page)).toBeVisible()
}

test('Edit opens the Employee edit modal from the card menu', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')
  await hire(page, NAME)

  await openTheCardMenu(page)
  await cardMenu(page).getByRole('menuitem', { name: 'Edit', exact: true }).click()

  // The edit screen the ticket asks for, on this Employee, and the menu is out of the way.
  await expect(page.getByRole('dialog', { name: `Edit ${NAME}` })).toBeVisible()
  await expect(cardMenu(page)).toHaveCount(0)
  expect(tinycorp.takeErrors()).toEqual([])
})

test('the card menu closes on Escape and on a press outside it', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')
  await hire(page, NAME)

  await openTheCardMenu(page)
  await page.keyboard.press('Escape')
  await expect(cardMenu(page)).toHaveCount(0)

  await openTheCardMenu(page)
  await page.getByRole('heading', { name: 'Employees' }).click()
  await expect(cardMenu(page)).toHaveCount(0)
  // Nothing was opened by the press that closed it.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(tinycorp.takeErrors()).toEqual([])
})
