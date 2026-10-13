import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from './fixtures'

/**
 * The window stays on the app's own document (T199, finding H2).
 *
 * `webPreferences` belong to the webContents and not to the document, so a window that can be
 * navigated is a window that hands the next page its preload script and every IPC channel on it.
 * The trigger a boss could really reach was a drop: Chromium navigates a page that does not handle
 * one to whatever was dropped, and an Employee only has to write an HTML file into its worktree
 * and ask the boss to drag it onto the office to look at it.
 *
 * A drop cannot be posted into a page from here, so the test does what the drop does — the
 * renderer asks for a foreign document — and proves the window is still the app's afterwards. It
 * is a `file:` page on the same disk as the app's own, because that is the one the exploit uses
 * and the one a guard that only checks the scheme would let straight through.
 */
/** The Launcher's own line: the app drew it, and drew it from a read over the bridge. */
const LAUNCHER = 'Create a company to put an office to work.'

test('refuses to leave the app’s own document', async ({ tinycorp }) => {
  const { page, companyFolder } = tinycorp
  const report = join(companyFolder, 'report.html')
  await writeFile(report, '<!doctype html><title>Dropped</title><body>A file an Employee wrote.</body>')
  await expect(page.getByText(LAUNCHER)).toBeVisible()
  const here = page.url()

  for (const target of [pathToFileURL(report).href, 'https://example.com/']) {
    // An expression rather than a function: this suite is typed for Node, and `location` is the
    // page's own. Asking from inside the document is what a drop does and what `loadURL` does not:
    // neither `will-navigate` nor `will-frame-navigate` is emitted for a navigation the main
    // process started itself.
    await page.evaluate(`location.href = ${JSON.stringify(target)}`)
    // The navigation is refused rather than delayed, so the page has to be given the chance to go.
    await page.waitForTimeout(1_000)

    expect(page.url(), `the window followed ${target}`).toBe(here)
  }

  // Still the app it was, asked of the document rather than through a locator: a refused
  // navigation leaves Playwright waiting on a document Chromium never made, while the window
  // itself is untouched.
  expect(await page.evaluate('document.body.innerText')).toContain(LAUNCHER)
  expect(tinycorp.takeErrors()).toEqual([])
})

/**
 * The policy the document carries in its `<meta>` tag is sent as a response header as well, so it
 * belongs to the session rather than to one document (`src/main/app/window-policy.ts`).
 */
test('serves its own page under a Content-Security-Policy header', async ({ tinycorp }) => {
  const response = await tinycorp.page.reload()

  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
})
