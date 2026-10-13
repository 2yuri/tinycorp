import { defineConfig } from '@playwright/test'

/**
 * The end-to-end suite (T189): the real app, started from the real build, driven through the real
 * screens. `tools/smoke-packaged.mjs` proves the packaged app opens a window; this proves a boss
 * can get from that window to an office.
 *
 * There are no screenshot comparisons here, on purpose. Fonts differ per operating system, so a
 * pixel assertion would be a test of the runner rather than of the app — `pnpm design:compare` is
 * where a screen is held against its Pen frame, on one machine, by eye.
 */

const ci = process.env['CI'] !== undefined

export default defineConfig({
  testDir: 'e2e',
  // Each test starts an Electron of its own against a throwaway user-data folder. They would not
  // fight, but a runner with two of them on it is a runner where neither is the thing being timed.
  workers: 1,
  fullyParallel: false,
  // A cold Electron start on a shared runner, twice over, with room to fail rather than hang.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: ci,
  // A first failure is looked at, not retried away: the suite is two tests and both are cheap.
  retries: 0,
  reporter: ci ? [['github'], ['list']] : [['list']],
  use: { trace: 'retain-on-failure' },
  outputDir: 'e2e/.results',
})
