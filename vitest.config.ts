import { defineConfig } from 'vitest/config'

/**
 * Three projects, one config. `unit` and `dom` are what `pnpm test` runs; `real` is what
 * `pnpm test:claude` runs, against real CLIs on the boss's own login, and never joins the others.
 *
 * Which environment a test wants is read off its path (`*.dom.test.tsx`), not off a comment at the
 * top of the file: a config that can see the answer can also promise that `unit` never pays jsdom's
 * startup for a test that has no DOM (T183).
 */

/**
 * Git, for the repos the suite makes in temp folders and then reads back. `GIT_CONFIG_*` is
 * git's own way of laying settings over a machine's, and every `git` a test starts inherits it.
 *
 * `core.autocrlf` is the one that matters: a Windows runner has it on globally, so a worktree
 * the app checks out comes back with CRLF and a test about what an Employee wrote becomes a
 * test about git's configuration. The app itself leaves the boss's setting alone — how their
 * own repo checks out is theirs (T166).
 */
const gitEnv = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.autocrlf',
  GIT_CONFIG_VALUE_0: 'false',
}

const shared = {
  /**
   * Vitest's own 5s is a Mac's 5s, where the whole suite takes ten. A Windows runner starts a
   * process, makes a file and opens a socket several times more slowly: its slowest honest test
   * — a real Company folder, a real SQLite database, real git — takes about ten seconds there,
   * and the first one in a worker has paid nearly a minute. This is the ceiling a test which has
   * actually hung hits, not a time anything is expected to take (T166).
   */
  testTimeout: 60_000,
  hookTimeout: 60_000,
  // One worker per file, always: the engine writes real files and real SQLite databases, and a
  // worker reused across files carries whatever the last one left in module state.
  isolate: true,
  env: gitEnv,
}

// Renderer tests read stylesheets with `?raw`; unprocessed CSS would come back empty.
const rawCss = { css: { include: [/\.css\?raw$/] } }

// Both projects that run renderer code get the empty preload bridge; `real` never loads a screen.
const rendererSetup = { setupFiles: ['./vitest.setup.ts'] }

/** The jsdom tests, by name. A test that needs a document says so where the config can read it. */
const DOM = ['src/**/*.dom.test.ts', 'src/**/*.dom.test.tsx']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          environment: 'node',
          // `tools/bench` is the token benchmark (T190): plain Node, no DOM, and its tests
          // are about arithmetic and argument parsing, so they belong with the node project.
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/bench/**/*.test.ts'],
          exclude: ['**/node_modules/**', ...DOM],
          ...rawCss,
          ...rendererSetup,
        },
        define: { __APP_VERSION__: JSON.stringify('test') },
      },
      {
        test: {
          ...shared,
          name: 'dom',
          environment: 'jsdom',
          include: DOM,
          ...rawCss,
          ...rendererSetup,
        },
        define: { __APP_VERSION__: JSON.stringify('test') },
      },
      {
        test: {
          ...shared,
          name: 'real',
          environment: 'node',
          // Against real external programs on the boss's own login: slow, and it spends usage.
          // `pnpm test:claude` asks for this one by name; `pnpm test` never does.
          include: ['src/**/*.itest.ts'],
        },
        define: { __APP_VERSION__: JSON.stringify('test') },
      },
    ],
    // Half the cores, not all of them: several worktrees often run the suite at once, and a
    // run that takes every core leaves the machine unusable while it lasts.
    maxWorkers: '50%',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // The engine and the contract between the processes. The renderer is covered by the screens
      // it draws, which is a different question and a different number. Only the TypeScript: the
      // example Provider's README and its `.template` are not source, and v8 parses what it is given.
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.itest.ts', '**/testing.ts'],
      // No thresholds yet: the number is being watched before it is being enforced (T183).
    },
  },
})
