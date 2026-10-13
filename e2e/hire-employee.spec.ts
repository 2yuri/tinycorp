import type { Page } from '@playwright/test'
import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * The Hire Employee modal never scrolls sideways (T224).
 *
 * It did: `LookField` put `w-full` and `w-132` on one element, Tailwind's emission order gave it to
 * `w-full`, the LOOK column took the whole row, and NAME and MODEL were pushed past the modal's
 * right edge — where focusing NAME on open scrolled the body 149px to reach them, so the boss's
 * first sight of the modal was a screen already scrolled off its own left side.
 *
 * jsdom lays nothing out, so the overflow has to be measured in a window that does. `scrollWidth`
 * over `clientWidth` is the whole assertion: a body with nothing hanging out of it has the two
 * equal, however long the name in the field is.
 */

/**
 * Opens the modal. `Hire Employee` is on the Office header and on the Employees screen the header
 * sends the boss to, so once the screen is up there are two of them and either will do.
 */
const openHire = (page: Page) => page.getByRole('button', { name: 'Hire Employee' }).first().click()

/** A name past any field's width, to say that the modal's own box is what holds. */
const LONG_NAME = 'Bartholomew Maximilian Wolfeschlegelsteinhausenbergerdorff'

test('Hire Employee never scrolls sideways, whatever is in its fields', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')

  await openHire(page)
  const modal = page.getByRole('dialog', { name: 'Hire an employee' })
  await expect(modal).toBeVisible()

  const body = modal.locator('[data-ui="Modal Form"]')
  /** What the body can scroll sideways by: 0 on a modal that fits inside itself. */
  const sideways = () => body.evaluate((el) => el.scrollWidth - el.clientWidth)

  // As it opens — the state the bug was in, because NAME takes the focus and drags the body to it.
  await expect.poll(sideways).toBe(0)

  // The longest thing the boss can put in it.
  await modal.getByRole('textbox').first().fill(LONG_NAME)
  await expect.poll(sideways).toBe(0)

  // And the longest model name the catalogue has, chosen the way a boss chooses one.
  await modal.getByRole('button', { name: 'Model' }).click()
  const models = modal.getByRole('menuitemradio')
  const longest = await models.evaluateAll((rows) =>
    rows.reduce(
      (widest, row) => ((row.textContent ?? '').length > widest.length ? (row.textContent ?? '') : widest),
      '',
    ),
  )
  await models.filter({ hasText: longest }).first().click()
  await expect.poll(sideways).toBe(0)

  expect(tinycorp.takeErrors()).toEqual([])
})

/**
 * The rest of the modal, on the way past (T224): the bug was a layout one, so what it is worth
 * saying here is that the controls under it still work — the footer's two buttons, and the hire
 * itself, which is the only thing the modal is for.
 */
test('Cancel closes the modal, and Hire puts the Employee in the office', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')

  const modal = page.getByRole('dialog', { name: 'Hire an employee' })

  await openHire(page)
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(modal).toBeHidden()

  await openHire(page)
  await modal.getByRole('textbox').first().fill('Lyra')
  await modal.getByRole('button', { name: 'Hire Lyra' }).click()

  // The modal closes onto the Employees screen the header sent the boss to, with one on staff.
  await expect(modal).toBeHidden()
  await expect(page.getByRole('button', { name: /^TI Testers Inc 1 Employee/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open Lyra' })).toBeVisible()
})
