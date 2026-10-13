import { createCompanyAndOpenTheOffice, expect, test } from './fixtures'

/**
 * The road every boss takes exactly once: an app that has never been opened, a Company created in
 * a folder they chose, and the office of it (T189).
 *
 * Every layer is the real one — the built main process, the real engine, a real SQLite database in
 * a real folder, the real React shell over the real IPC contract. Only two things are not: the
 * Provider is the suite's fake, so nothing starts a `claude`, and the operating system's folder
 * picker is answered rather than opened, because nothing in a page can click one.
 */
test('opens to the Launcher, creates a Company and lands on the Office', async ({ tinycorp }) => {
  const { page } = tinycorp

  // With no Company, the window is the Launcher, and it says what it is for.
  await expect(page).toHaveTitle('tinycorp')
  await expect(page.getByText('Create a company to put an office to work.')).toBeVisible()

  await createCompanyAndOpenTheOffice(tinycorp, 'Testers Inc')

  // The Office of the Company that was just made, with its own name on the floor.
  await expect(page.getByRole('button', { name: 'Office', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Testers Inc' })).toBeVisible()
  // Skipping the wizard hires nobody, so the floor says so rather than drawing a team.
  await expect(page.getByText('0 at work')).toBeVisible()
  // The screen and its canvas each come in a chunk of their own (T211), and a chunk that never
  // arrives shows as nothing at all rather than as an error — so the floor itself is asserted.
  await expect(page.getByTestId('office')).toBeVisible()
  expect(tinycorp.takeErrors()).toEqual([])
})
