import type { Page } from '@playwright/test'
import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * Unsent composer drafts, through the real screens (TI-1).
 *
 * The composer keeps what is typed in the Company database, a debounce after the last keystroke
 * and again when it goes, and reads it back when the boss returns. Every part of that is a seam
 * the unit tests stand on either side of: the renderer's timer, the preload bridge, the IPC
 * contract, the SQLite table, and the sidebar redrawing off `chat:changed`. This is the one place
 * they all run at once, and it is the check the pull request said it had not done.
 */

const DRAFT = 'half a thought about the migration'

/** The channel's own composer: what the placeholder says depends on who has been hired. */
const composer = (page: Page) => page.locator('main textarea').first()
const channel = (page: Page, name: string) => page.locator('[data-ui="Nav Child"]', { hasText: name }).first()
const pencilOn = (page: Page, name: string) => channel(page, name).locator('[data-ui="Nav Draft"]')

test('a composer keeps what was left unsent, and the sidebar says where', async ({ tinycorp }) => {
  const { page } = tinycorp
  await createCompanyAndOpenTheOffice(tinycorp, 'Drafters Inc')

  // The rail's Chat section opens on the channels; each of them is a row of its own under it.
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await channel(page, 'tech').click()
  await composer(page).fill(DRAFT)
  // The row says so while the boss is still in the channel: the draft landed and the sidebar heard.
  await expect(pencilOn(page, 'tech')).toBeVisible()

  await channel(page, 'general').click()
  await expect(composer(page)).toHaveValue('')
  await expect(pencilOn(page, 'general')).toHaveCount(0)

  await channel(page, 'tech').click()
  await expect(composer(page)).toHaveValue(DRAFT)

  // And it outlives the window it was typed in: the renderer comes up again with nothing in its
  // own memory and reads the draft back out of the Company database, as it does after a restart.
  await page.reload()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await channel(page, 'tech').click()
  await expect(composer(page)).toHaveValue(DRAFT)

  // Sent, the draft and its mark go together.
  await composer(page).press('Enter')
  await expect(page.getByText(DRAFT)).toBeVisible()
  await expect(composer(page)).toHaveValue('')
  await expect(pencilOn(page, 'tech')).toHaveCount(0)

  expect(tinycorp.takeErrors(), 'the chat wrote to the console').toEqual([])
})
