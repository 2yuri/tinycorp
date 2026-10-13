import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, type ElectronApplication, _electron as electron, expect, type Page } from '@playwright/test'
import { E2E_ENV } from '../src/main/app/e2e-mode'

/**
 * Starting the real app for an end-to-end run, and putting it back afterwards (T189).
 *
 * Everything the run writes goes to folders of its own under `os.tmpdir()`: the Chromium profile
 * and the app's whole `userData` through `--user-data-dir`, and the Company the run creates into a
 * second folder. The boss's own profile and Companies are never opened, never read and never
 * written — a suite that could reach them is a suite nobody would run twice.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

/** What `pnpm build` leaves behind, and what `_electron.launch` starts. */
const BUILT_MAIN = join(REPO, 'out', 'main', 'index.js')

export interface TinyCorpApp {
  app: ElectronApplication
  page: Page
  /** The folder the Company is created into: empty, in `os.tmpdir()`, gone after the test. */
  companyFolder: string
  /**
   * Every console error and uncaught renderer error since it was last asked, and empties the list.
   * A screen that threw while being drawn says so here even when it drew something anyway.
   */
  takeErrors(): string[]
}

export const test = base.extend<{ tinycorp: TinyCorpApp }>({
  // Playwright reads a fixture's dependencies off this very pattern, and this one has none: it
  // must not be handed a browser `page`, which would start a Chromium beside the app.
  // biome-ignore lint/correctness/noEmptyPattern: the empty pattern is how that is said.
  tinycorp: async ({}, use) => {
    if (!existsSync(BUILT_MAIN)) {
      throw new Error(`No build to run: ${BUILT_MAIN} is missing — run \`pnpm build\` first.`)
    }
    const userData = await mkdtemp(join(tmpdir(), 'tinycorp-e2e-user-'))
    const companyFolder = await mkdtemp(join(tmpdir(), 'tinycorp-e2e-company-'))
    const app = await electron.launch({
      // The repo root rather than the file: Electron reads `main`, the name and the version out of
      // `package.json` there, which is what the window and the Launcher's footer say.
      args: [REPO, `--user-data-dir=${userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
      env: { ...process.env, [E2E_ENV]: '1' },
    })
    const errors: string[] = []
    const window = await app.firstWindow()
    window.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    window.on('pageerror', (error) => errors.push(error.message))
    try {
      await use({
        app,
        page: window,
        companyFolder,
        takeErrors: () => errors.splice(0, errors.length),
      })
    } finally {
      await app.close()
      await rm(userData, { recursive: true, force: true })
      await rm(companyFolder, { recursive: true, force: true })
    }
  },
})

export { expect }

/**
 * Answers the next native folder picker with `folder`, without opening one.
 *
 * `dialog.showOpenDialog` is the operating system's own window: nothing in the page can reach it
 * and nothing can click it, so the run replaces it in the main process for as long as it lasts.
 * It is the one thing here that is not the app a boss runs, and it has to be — the alternative is
 * a second switch, shipped, for a folder.
 */
export async function answerFolderPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    const answer: typeof dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
    dialog.showOpenDialog = answer
  }, folder)
}

/**
 * The Launcher → Create a company → the setup wizard → the Office, which is the road every boss
 * takes once. Leaves the app on the Office of a Company called `name`, in the run's temp folder.
 */
export async function createCompanyAndOpenTheOffice(tinycorp: TinyCorpApp, name: string): Promise<void> {
  const { app, page, companyFolder } = tinycorp
  await page.getByRole('button', { name: 'Create a company' }).click()

  await page.getByPlaceholder('Name your company').fill(name)
  await answerFolderPicker(app, companyFolder)
  await page.getByRole('button', { name: 'Folder' }).click()
  // The form knows where the Company goes once the picker has answered.
  await expect(page.getByRole('button', { name: 'Folder' })).not.toContainText('Choose a folder')
  await page.getByRole('button', { name: 'Create company' }).click()

  // A new Company opens into its setup wizard, wherever it was opened from (decision 39, T59).
  await expect(page).toHaveTitle(`${name} — Setup`)
  await page.getByRole('button', { name: 'Skip setup' }).click()

  await expect(page).toHaveTitle(`${name} — Office`)
}
